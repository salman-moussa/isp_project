import type { Clock, CollectSyncEndpoint, SyncOutcome } from './adapters.js';
import { CollectAccessError, type CollectState, type OutboxOperation } from './model.js';
import type { CollectStore } from './storage.js';

function readyOperations(state: CollectState, batchSize: number): OutboxOperation[] {
  const completed = new Set(
    state.outbox
      .filter((operation) => operation.status === 'accepted')
      .map((operation) => operation.operationId),
  );
  return state.outbox
    .filter(
      (operation) =>
        operation.status === 'pending' &&
        operation.dependencies.every((dependency) => completed.has(dependency)),
    )
    .sort((left, right) => left.createdLocalSequence - right.createdLocalSequence)
    .slice(0, batchSize);
}

function updateOperation(state: CollectState, outcome: SyncOutcome): void {
  const index = state.outbox.findIndex(
    (operation) => operation.operationId === outcome.operationId,
  );
  const operation = state.outbox[index];
  if (operation === undefined)
    throw new Error(`Server returned an unknown operation ${outcome.operationId}.`);
  if (outcome.status === 'retryable') {
    state.outbox[index] = {
      ...operation,
      attemptCount: operation.attemptCount + 1,
      failureCode: outcome.code,
    };
    return;
  }
  if (outcome.status === 'accepted') {
    state.outbox[index] = {
      ...operation,
      status: 'accepted',
      attemptCount: operation.attemptCount + 1,
      canonicalReference: outcome.canonicalReference,
    };
    const paymentIndex = state.payments.findIndex(
      (payment) => payment.operationId === operation.operationId,
    );
    const payment = state.payments[paymentIndex];
    if (payment !== undefined) {
      state.payments[paymentIndex] = {
        ...payment,
        syncStatus: 'accepted',
        canonicalPaymentId: outcome.canonicalReference,
        ...(outcome.canonicalReceiptNumber === undefined
          ? {}
          : { canonicalReceiptNumber: outcome.canonicalReceiptNumber }),
      };
    }
    const reconciliationIndex = state.reconciliations.findIndex(
      (item) => item.operationId === operation.operationId,
    );
    const reconciliation = state.reconciliations[reconciliationIndex];
    if (reconciliation !== undefined)
      state.reconciliations[reconciliationIndex] = { ...reconciliation, status: 'accepted' };
    return;
  }
  state.outbox[index] = {
    ...operation,
    status: outcome.status,
    attemptCount: operation.attemptCount + 1,
    failureCode: outcome.code,
  };
  const paymentIndex = state.payments.findIndex(
    (payment) => payment.operationId === operation.operationId,
  );
  const payment = state.payments[paymentIndex];
  if (payment !== undefined)
    state.payments[paymentIndex] = { ...payment, syncStatus: outcome.status };
  if (outcome.status === 'conflict') {
    state.conflicts.push({
      operationId: operation.operationId,
      code: outcome.code,
      safeLocalFacts: {
        type: operation.type,
        payloadHash: operation.payloadHash,
        occurredAtDevice: operation.occurredAtDevice,
      },
      safeServerFacts: outcome.safeServerFacts,
      allowedResolutions: ['retain_evidence', 'supersede_with_new_operation'],
    });
  }
}

export class CollectSyncEngine {
  public constructor(
    private readonly store: CollectStore,
    private readonly endpoint: CollectSyncEndpoint,
    private readonly clock: Clock,
  ) {}

  public async sync(
    batchSize = 25,
  ): Promise<{ sent: number; pending: number; checkpoint?: string }> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100)
      throw new Error('Invalid sync batch size.');
    const before = await this.store.read();
    if (before.device?.status === 'revoked') throw new CollectAccessError('revoked');
    if (before.device?.status === 'reauth_required')
      throw new CollectAccessError('reauth_required');
    if (before.device === undefined || before.session === undefined)
      throw new CollectAccessError('reauth_required');
    if (Date.parse(before.session.expiresAt) <= this.clock.now().getTime())
      throw new CollectAccessError('session_expired');
    const batch = readyOperations(before, batchSize);
    if (batch.length === 0) {
      return {
        sent: 0,
        pending: before.outbox.filter((operation) => operation.status === 'pending').length,
        ...(before.lastServerCheckpoint === undefined
          ? {}
          : { checkpoint: before.lastServerCheckpoint }),
      };
    }

    let response;
    try {
      response = await this.endpoint.push({
        deviceId: before.device.deviceId,
        sessionId: before.session.sessionId,
        operations: batch,
      });
    } catch {
      await this.store.transaction((state) => {
        const sent = new Set(batch.map((operation) => operation.operationId));
        state.outbox = state.outbox.map((operation) =>
          sent.has(operation.operationId)
            ? {
                ...operation,
                attemptCount: operation.attemptCount + 1,
                failureCode: 'transport_unavailable',
              }
            : operation,
        );
      });
      const state = await this.store.read();
      return {
        sent: batch.length,
        pending: state.outbox.filter((operation) => operation.status === 'pending').length,
      };
    }

    await this.store.transaction((state) => {
      if (response.deviceStatus !== 'authorized') {
        if (state.device !== undefined) {
          state.device = {
            ...state.device,
            status: response.deviceStatus,
            ...(response.deviceStatus === 'revoked' ? { revocationReason: 'server_revoked' } : {}),
          };
        }
        delete state.session;
        state.lockedReason = response.deviceStatus === 'revoked' ? 'revoked' : 'reauth_required';
        return;
      }
      const requested = new Set(batch.map((operation) => operation.operationId));
      for (const outcome of response.outcomes) {
        if (!requested.has(outcome.operationId))
          throw new Error('Sync response contained an operation outside the request batch.');
        updateOperation(state, outcome);
      }
      state.lastServerCheckpoint = response.checkpoint;
    });
    const after = await this.store.read();
    if (response.deviceStatus === 'revoked') throw new CollectAccessError('revoked');
    if (response.deviceStatus === 'reauth_required')
      throw new CollectAccessError('reauth_required');
    return {
      sent: batch.length,
      pending: after.outbox.filter((operation) => operation.status === 'pending').length,
      checkpoint: response.checkpoint,
    };
  }
}
