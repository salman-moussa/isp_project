import { describe, expect, it } from 'vitest';
import type { VerifiedTenantId } from '@isp/contracts';
import {
  CollectApiService,
  CollectTokenInvalidError,
  canonicalCollectJson,
  payloadHash,
  type CollectBackendRepository,
  type CollectDeviceIdentity,
} from './collect-service.js';

const tenantId = '10000000-0000-4000-8000-000000000001' as VerifiedTenantId;
const collectorId = '20000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-13T08:00:00.000Z');

class FakeRepository implements CollectBackendRepository {
  public authorizeInput?: Parameters<CollectBackendRepository['authorizeDevice']>[1];
  public rotationInput?: Parameters<CollectBackendRepository['rotateTokens']>[0];
  public syncInput?: Parameters<CollectBackendRepository['sync']>[0];
  public validAccessDigest?: Uint8Array;
  public validRefreshDigest?: Uint8Array;
  public readonly device: CollectDeviceIdentity = {
    deviceId: '40000000-0000-4000-8000-000000000001',
    tenantId,
    collectorUserId: collectorId,
    sessionId,
    scopes: [
      'assignments:read',
      'payments:create',
      'reconciliations:submit',
      'receipts:print:audit',
    ],
    accessExpiresAt: '2026-08-13T08:10:00.000Z',
  };
  async authorizeDevice(
    _tenantId: VerifiedTenantId,
    input: Parameters<CollectBackendRepository['authorizeDevice']>[1],
  ) {
    this.authorizeInput = input;
    this.validAccessDigest = input.accessTokenDigest;
    this.validRefreshDigest = input.refreshTokenDigest;
    return this.device;
  }
  async authenticateAccessToken(digest: Uint8Array) {
    return equal(digest, this.validAccessDigest) ? this.device : null;
  }
  async rotateTokens(input: Parameters<CollectBackendRepository['rotateTokens']>[0]) {
    this.rotationInput = input;
    if (!equal(input.presentedRefreshTokenDigest, this.validRefreshDigest)) return null;
    this.validAccessDigest = input.accessTokenDigest;
    this.validRefreshDigest = input.refreshTokenDigest;
    return this.device;
  }
  async readBootstrap() {
    return { assignments: [] };
  }
  async readDelta() {
    return { assignments: [] };
  }
  async sync(input: Parameters<CollectBackendRepository['sync']>[0]) {
    this.syncInput = input;
    return [];
  }
  async approveDiscrepancy() {
    return { approved: true };
  }
}

function createService(repository = new FakeRepository()) {
  return {
    repository,
    service: new CollectApiService(
      repository,
      { isActive: async () => true },
      {
        operationsKeyId: 'collect-test',
        operationsSecret: new Uint8Array(32).fill(7),
      },
      () => now,
    ),
  };
}
const request = {
  actorId: collectorId,
  sessionId,
  requestId: 'request-collect-001',
  ipAddress: '127.0.0.1',
  deviceLabel: 'Collector phone',
  devicePublicKeyThumbprint: 'sha256:device-public-key-thumbprint',
  mfaVerifiedAt: new Date('2026-08-13T07:55:00.000Z'),
};

describe('Collect API service token and sync contract', () => {
  it('returns opaque one-time tokens while the repository receives only unrelated SHA-256 digests', async () => {
    const { service, repository } = createService();
    const issued = await service.authorizeDevice(tenantId, request);
    expect(issued.accessToken).toMatch(/^orvex_collect_a1\./);
    expect(issued.refreshToken).toMatch(/^orvex_collect_r1\./);
    expect(repository.authorizeInput?.accessTokenDigest).toHaveLength(32);
    expect(repository.authorizeInput?.refreshTokenDigest).toHaveLength(32);
    expect(
      Buffer.from(repository.authorizeInput!.accessTokenDigest).toString('utf8'),
    ).not.toContain(issued.accessToken);
    await expect(service.authenticate(issued.accessToken)).resolves.toEqual(repository.device);
  });

  it('rotates refresh tokens so the prior refresh token cannot be reused', async () => {
    const { service } = createService();
    const issued = await service.authorizeDevice(tenantId, request);
    const rotated = await service.refresh(issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(
      CollectTokenInvalidError,
    );
  });

  it('requires fresh MFA and signs bounded sync with canonical changed-payload detection hashes', async () => {
    const { service, repository } = createService();
    await expect(
      service.authorizeDevice(tenantId, {
        ...request,
        mfaVerifiedAt: new Date('2026-08-13T07:49:59.000Z'),
      }),
    ).rejects.toBeInstanceOf(CollectTokenInvalidError);
    const issued = await service.authorizeDevice(tenantId, request);
    const operations = [
      {
        operationId: '50000000-0000-4000-8000-000000000001',
        sequence: 1,
        type: 'payment.create' as const,
        payload: {
          assignmentId: '60000000-0000-4000-8000-000000000001',
          amountMinor: 5000,
          currency: 'USD' as const,
          clientRecordedAt: '2026-08-13T07:59:00.000Z',
        },
      },
    ];
    const operation = operations[0]!;
    await service.sync(
      issued.device,
      { requestId: 'sync-001', ipAddress: '127.0.0.1' },
      operations,
    );
    expect(repository.syncInput?.operations).toEqual(operations);
    expect(repository.syncInput?.payloadHashes[operation.operationId]).toBe(payloadHash(operation));
    expect(payloadHash(operation)).not.toBe(
      payloadHash({ ...operation, payload: { ...operation.payload, amountMinor: 5001 } }),
    );
  });

  it('canonicalizes object keys deterministically', () => {
    expect(canonicalCollectJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });
});

function equal(left: Uint8Array, right?: Uint8Array): boolean {
  return right !== undefined && Buffer.from(left).equals(Buffer.from(right));
}
