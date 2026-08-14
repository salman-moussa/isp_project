import type { VerifiedTenantId } from '@isp/contracts';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeOperationsContextSecret,
  PostgresOperationsService,
  type OperationsRepositoryAdapter,
} from './operations-service.js';
import type { OperationsMutationContext } from './routes/operations/contracts.js';

const tenantId = '00000000-0000-4000-8000-00000000000a' as VerifiedTenantId;
const secret = Buffer.from('0123456789abcdef0123456789abcdef');

const context: OperationsMutationContext = {
  actorId: 'operations-user-a',
  sessionId: 'operations-session-a',
  idempotencyKey: 'network-action-001',
  requestId: 'request-a',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
  permission: 'tenant.network.job.create',
  auditAction: 'tenant.network.job.create',
  reason: 'Authorized subscriber network profile change.',
  branchIds: ['20000000-0000-4000-8000-000000000001'],
  areaIds: [],
  routeIds: ['40000000-0000-4000-8000-000000000001'],
};

describe('Operations production adapter', () => {
  it('rejects malformed and undersized context secrets', () => {
    expect(() => decodeOperationsContextSecret('not base64!')).toThrow('canonical base64');
    expect(() => decodeOperationsContextSecret(Buffer.from('short').toString('base64'))).toThrow(
      'at least 32 bytes',
    );
  });

  it('signs claim-derived scope and keeps the audited action distinct from the network action', async () => {
    const enqueueSubscriberNetworkAction = vi.fn<
      OperationsRepositoryAdapter['enqueueSubscriberNetworkAction']
    >(async () => ({ id: 'job-a', replayed: false }));
    const repository = {
      enqueueSubscriberNetworkAction,
    } as unknown as OperationsRepositoryAdapter;
    const service = new PostgresOperationsService(
      {} as never,
      { keyId: 'operations-v1', secret },
      () => new Date('2026-08-13T10:00:00.000Z'),
      repository,
    );

    await service.enqueueNetworkAction(tenantId, {
      ...context,
      serviceId: '10000000-0000-4000-8000-000000000001',
      action: 'change_profile',
      payload: { profileReference: '20M' },
    });

    expect(enqueueSubscriberNetworkAction).toHaveBeenCalledOnce();
    const [, forwardedTenantId, input] = enqueueSubscriberNetworkAction.mock.calls[0] ?? [];
    expect(forwardedTenantId).toBe(tenantId);
    expect(input).toMatchObject({
      action: 'change_profile',
      payload: { profileReference: '20M' },
      requestedBy: context.actorId,
    });
    const authorization = input?.authorization;
    expect(authorization).toBeDefined();
    const attestation = JSON.parse(authorization?.attestationText ?? '{}') as Record<
      string,
      unknown
    >;
    expect(attestation).toMatchObject({
      keyId: 'operations-v1',
      tenantId,
      actorId: context.actorId,
      sessionId: context.sessionId,
      permission: context.permission,
      action: context.auditAction,
      branchIds: context.branchIds,
      areaIds: context.areaIds,
      routeIds: context.routeIds,
      expiresAt: '2026-08-13T10:01:00.000Z',
    });
    expect(attestation.action).not.toBe(input?.action);
    expect(authorization?.signatureHex).toBe(
      createHmac('sha256', secret)
        .update(authorization?.attestationText ?? '')
        .digest('hex'),
    );
  });
});
