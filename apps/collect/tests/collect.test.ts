import { describe, expect, it } from 'vitest';

import type {
  Assignment,
  CollectorSession,
  DeviceRegistration,
  PaymentInput,
} from '../src/core/model';
import { CollectAccessError, CollectValidationError } from '../src/core/model';
import { CollectService } from '../src/core/collect-service';
import {
  FakeClock,
  FakePrinter,
  FakeSyncEndpoint,
  SequenceIds,
  StableTestHasher,
} from '../src/core/fakes';
import {
  EncryptedCollectStore,
  DurableMemoryDriver,
  MemoryKeyVault,
  type StateDatabaseDriver,
} from '../src/core/storage';
import { CollectSyncEngine } from '../src/core/sync-engine';

const clock = new FakeClock();
const device: DeviceRegistration = {
  deviceId: 'device-collector-000001',
  collectorId: 'collector-1',
  tenantId: 'tenant-1',
  status: 'authorized',
  authorizedAt: '2026-08-13T08:00:00.000Z',
  cachedAssignmentsExpireAt: '2026-08-14T09:00:00.000Z',
};
const session: CollectorSession = {
  sessionId: 'session-1',
  tokenHandle: 'secure-store:session-1',
  deviceId: device.deviceId,
  collectorId: device.collectorId,
  tenantId: device.tenantId,
  assignmentContextVersion: 3,
  authenticatedAt: '2026-08-13T08:55:00.000Z',
  mfaVerifiedAt: '2026-08-13T08:56:00.000Z',
  expiresAt: '2026-08-13T18:00:00.000Z',
};
const assignment: Assignment = {
  assignmentId: 'assignment-1',
  assignmentVersion: 3,
  routeId: 'route-1',
  routeNameEn: 'Beirut route',
  routeNameAr: 'مسار بيروت',
  subscriberId: 'subscriber-1',
  subscriberName: 'Assigned Subscriber',
  serviceReference: 'SVC-1',
  areaEn: 'Hamra',
  areaAr: 'الحمرا',
  outstandingMinor: 5000,
  currency: 'USD',
};
const payment: PaymentInput = {
  assignmentId: assignment.assignmentId,
  amountMinor: 2500,
  currency: 'USD',
  method: 'cash',
  allocationInvoiceId: 'invoice-1',
  occurredAtDevice: '2026-08-13T09:00:00.000Z',
};

async function harness(driver = new DurableMemoryDriver()): Promise<{
  driver: DurableMemoryDriver;
  store: EncryptedCollectStore;
  service: CollectService;
  endpoint: FakeSyncEndpoint;
  sync: CollectSyncEngine;
}> {
  const store = await EncryptedCollectStore.open({
    mode: 'test',
    keyVault: new MemoryKeyVault(),
    driver,
  });
  const service = new CollectService(store, clock, new SequenceIds(), new StableTestHasher());
  await service.installBootstrap({ device, session, assignments: [assignment] });
  const endpoint = new FakeSyncEndpoint();
  return { driver, store, service, endpoint, sync: new CollectSyncEngine(store, endpoint, clock) };
}

describe('Orvex ISP Collect security and offline day invariants', () => {
  it('refuses every plaintext driver and has no production fallback (PRD-MOB-003/009)', async () => {
    const plaintext: StateDatabaseDriver = {
      encryption: 'none',
      open: async () => undefined,
      read: async () => undefined,
      replace: async () => undefined,
    };
    await expect(
      EncryptedCollectStore.open({
        mode: 'production',
        keyVault: new MemoryKeyVault(),
        driver: plaintext,
      }),
    ).rejects.toThrow('plaintext fallback is forbidden');
    await expect(
      EncryptedCollectStore.open({
        mode: 'test',
        keyVault: new MemoryKeyVault(),
        driver: plaintext,
      }),
    ).rejects.toThrow('Plaintext Collect storage is forbidden');
  });

  it('shows assigned records only and rejects currency ambiguity or mismatch (PRD-MOB-001/006)', async () => {
    const { service, store } = await harness();
    expect(await service.listAssignedRoutes()).toEqual([assignment]);
    await expect(service.recordPayment({ ...payment, currency: 'LBP' })).rejects.toBeInstanceOf(
      CollectValidationError,
    );
    await expect(
      service.recordPayment({ ...payment, assignmentId: 'other-collector-assignment' }),
    ).rejects.toBeInstanceOf(CollectAccessError);
    expect((await store.read()).payments).toHaveLength(0);
  });

  it('persists payment, receipt and outbox before offline success and survives restart (PRD-MOB-003/004)', async () => {
    const first = await harness();
    const local = await first.service.recordPayment(payment);
    first.endpoint.online = false;
    expect(await first.sync.sync()).toEqual({ sent: 1, pending: 1 });
    const restartedStore = await EncryptedCollectStore.open({
      mode: 'test',
      keyVault: new MemoryKeyVault(),
      driver: first.driver,
    });
    const restartedState = await restartedStore.read();
    expect(restartedState.payments[0]?.localPaymentId).toBe(local.localPaymentId);
    expect(restartedState.payments[0]?.provisionalReceiptNumber).toContain('0001');
    expect(restartedState.outbox[0]?.attemptCount).toBe(1);
    first.endpoint.online = true;
    const restartedSync = new CollectSyncEngine(restartedStore, first.endpoint, clock);
    await restartedSync.sync();
    expect((await restartedStore.read()).payments[0]?.syncStatus).toBe('accepted');
    expect(first.endpoint.received).toHaveLength(1);
  });

  it('replays a duplicate idempotency key to the same canonical result (PRD-MOB-004)', async () => {
    const { service, store, endpoint } = await harness();
    await service.recordPayment(payment);
    const operation = (await store.read()).outbox[0];
    expect(operation).toBeDefined();
    const first = await endpoint.push({
      deviceId: device.deviceId,
      sessionId: session.sessionId,
      operations: [operation!],
    });
    const second = await endpoint.push({
      deviceId: device.deviceId,
      sessionId: session.sessionId,
      operations: [operation!],
    });
    expect(first.outcomes[0]).toMatchObject({ status: 'accepted' });
    expect(second.outcomes[0]).toMatchObject(first.outcomes[0] ?? {});
  });

  it('classifies a conflict without overwriting payment evidence (PRD-MOB-005)', async () => {
    const { service, store, endpoint, sync } = await harness();
    const local = await service.recordPayment(payment);
    endpoint.conflictOperationIds.add(local.operationId);
    await sync.sync();
    const state = await store.read();
    expect(state.payments[0]).toMatchObject({
      amountMinor: 2500,
      currency: 'USD',
      syncStatus: 'conflict',
    });
    expect(state.conflicts[0]).toMatchObject({
      operationId: local.operationId,
      code: 'assignment_changed',
    });
    expect(state.conflicts[0]?.allowedResolutions).not.toContain('overwrite');
  });

  it('locks all fresh access after server revocation while retaining pending evidence (PRD-MOB-001/009)', async () => {
    const { service, store, endpoint, sync } = await harness();
    await service.recordPayment(payment);
    endpoint.deviceStatus = 'revoked';
    await expect(sync.sync()).rejects.toMatchObject({ code: 'revoked' });
    const state = await store.read();
    expect(state.device?.status).toBe('revoked');
    expect(state.session).toBeUndefined();
    expect(state.outbox[0]?.status).toBe('pending');
    await expect(service.listAssignedRoutes()).rejects.toBeInstanceOf(CollectAccessError);
  });

  it('preserves the payment when Bluetooth printing fails and queues a dependent audit (PRD-MOB-007)', async () => {
    const { service, store } = await harness();
    const local = await service.recordPayment(payment);
    const printer = new FakePrinter();
    printer.nextOutcome = 'disconnected';
    expect(await service.printReceipt(local.localPaymentId, printer)).toBe('disconnected');
    const state = await store.read();
    expect(state.payments[0]).toMatchObject({ syncStatus: 'pending', amountMinor: 2500 });
    expect(state.printAttempts[0]).toMatchObject({
      outcome: 'disconnected',
      failureCode: 'printer_disconnected',
    });
    expect(state.outbox[1]).toMatchObject({
      type: 'receipt.print.audit',
      dependencies: [local.operationId],
    });
  });

  it('records clock skew only as evidence and orders sync by local durable sequence (PRD-MOB-006)', async () => {
    const { service, store, endpoint, sync } = await harness();
    const skewed = await service.recordPayment({
      ...payment,
      occurredAtDevice: '2036-01-01T00:00:00.000Z',
    });
    const current = await service.recordPayment({
      ...payment,
      occurredAtDevice: '2026-08-13T09:00:00.000Z',
    });
    expect(skewed.clockSkewSuspected).toBe(true);
    expect(current.clockSkewSuspected).toBe(false);
    await sync.sync();
    expect(endpoint.received.map((operation) => operation.operationId)).toEqual([
      skewed.operationId,
      current.operationId,
    ]);
    expect((await store.read()).payments.every((item) => item.syncStatus === 'accepted')).toBe(
      true,
    );
  });

  it('keeps USD/LBP and methods separate in a durable idempotent reconciliation (PRD-MOB-008)', async () => {
    const driver = new DurableMemoryDriver();
    const { service } = await harness(driver);
    await service.recordPayment(payment);
    const draft = await service.saveReconciliationDraft({
      reconciliationId: 'reconciliation-1',
      businessDate: '2026-08-13',
      declared: [
        { currency: 'USD', method: 'cash', declaredMinor: 2400, denominationCounts: { '100': 24 } },
        { currency: 'LBP', method: 'cash', declaredMinor: 0 },
      ],
      note: 'USD short by one dollar',
    });
    expect(draft.lines).toEqual([
      expect.objectContaining({
        currency: 'USD',
        expectedMinor: 2500,
        declaredMinor: 2400,
        differenceMinor: -100,
      }),
      expect.objectContaining({
        currency: 'LBP',
        expectedMinor: 0,
        declaredMinor: 0,
        differenceMinor: 0,
      }),
    ]);
    expect(draft.requiresManagerApproval).toBe(true);
    const first = await service.submitReconciliation('reconciliation-1');
    const second = await service.submitReconciliation('reconciliation-1');
    expect(second.operationId).toBe(first.operationId);
    const restartedStore = await EncryptedCollectStore.open({
      mode: 'test',
      keyVault: new MemoryKeyVault(),
      driver,
    });
    expect((await restartedStore.read()).reconciliations[0]).toMatchObject({
      operationId: first.operationId,
      status: 'pending',
    });
    expect(
      (await restartedStore.read()).outbox.filter((item) => item.type === 'reconciliation.submit'),
    ).toHaveLength(1);
  });
});
