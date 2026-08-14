import { createHash, randomBytes } from 'node:crypto';
import type { Permission, SupportedCurrency, VerifiedTenantId } from '@isp/contracts';
import {
  approveCollectDiscrepancy,
  authenticateCollectAccessToken,
  authorizeCollectDevice,
  readCollectBootstrap,
  readCollectDelta,
  rotateCollectTokens,
  signOperationsAttestation,
  syncCollectOperations,
  type Database,
  type OperationsAttestation,
  type SignedOperationsDatabaseContext,
} from '@isp/database';

export type CollectDeviceScope =
  | 'assignments:read'
  | 'payments:create'
  | 'reconciliations:submit'
  | 'receipts:print:audit';

export interface CollectDeviceIdentity {
  readonly deviceId: string;
  readonly tenantId: VerifiedTenantId;
  readonly collectorUserId: string;
  readonly sessionId: string;
  readonly scopes: readonly CollectDeviceScope[];
  readonly accessExpiresAt: string;
}

export type CollectSyncOperation =
  | {
      readonly operationId: string;
      readonly sequence: number;
      readonly type: 'payment.create';
      readonly payload: {
        readonly assignmentId: string;
        readonly amountMinor: number;
        readonly currency: SupportedCurrency;
        readonly clientRecordedAt: string;
      };
    }
  | {
      readonly operationId: string;
      readonly sequence: number;
      readonly type: 'reconciliation.submit';
      readonly payload: {
        readonly routeId: string;
        readonly businessDate: string;
        readonly declaredAmountMinor: number;
        readonly currency: SupportedCurrency;
      };
    }
  | {
      readonly operationId: string;
      readonly sequence: number;
      readonly type: 'receipt.print.audit';
      readonly payload: {
        readonly assignmentId: string;
        readonly paymentId: string;
        readonly printerReference: string;
        readonly copyKind: 'original' | 'duplicate';
      };
    };

export interface CollectRequestContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
}

export interface CollectBackendRepository {
  authorizeDevice(
    tenantId: VerifiedTenantId,
    input: {
      readonly authorization: SignedOperationsDatabaseContext;
      readonly collectorUserId: string;
      readonly sourceSessionId: string;
      readonly deviceLabel: string;
      readonly devicePublicKeyThumbprint: string;
      readonly mfaVerifiedAt: Date;
      readonly accessTokenDigest: Uint8Array;
      readonly refreshTokenDigest: Uint8Array;
      readonly accessExpiresAt: Date;
      readonly refreshExpiresAt: Date;
      readonly scopes: readonly CollectDeviceScope[];
    },
  ): Promise<CollectDeviceIdentity>;
  authenticateAccessToken(accessTokenDigest: Uint8Array): Promise<CollectDeviceIdentity | null>;
  rotateTokens(input: {
    readonly presentedRefreshTokenDigest: Uint8Array;
    readonly accessTokenDigest: Uint8Array;
    readonly refreshTokenDigest: Uint8Array;
    readonly accessExpiresAt: Date;
    readonly refreshExpiresAt: Date;
  }): Promise<CollectDeviceIdentity | null>;
  readBootstrap(
    device: CollectDeviceIdentity,
    authorization: SignedOperationsDatabaseContext,
  ): Promise<unknown>;
  readDelta(
    device: CollectDeviceIdentity,
    authorization: SignedOperationsDatabaseContext,
    afterCursor: number,
    limit: number,
  ): Promise<unknown>;
  sync(input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly device: CollectDeviceIdentity;
    readonly operations: readonly CollectSyncOperation[];
    readonly payloadHashes: Readonly<Record<string, string>>;
    readonly requestId: string;
    readonly ipAddress: string;
    readonly userAgent?: string;
    readonly serverReceivedAt: Date;
  }): Promise<unknown>;
  approveDiscrepancy(
    tenantId: VerifiedTenantId,
    input: {
      readonly authorization: SignedOperationsDatabaseContext;
      readonly reconciliationId: string;
      readonly approverUserId: string;
      readonly reason: string;
      readonly idempotencyKey: string;
    },
  ): Promise<unknown>;
}

export interface CollectServiceConfig {
  readonly operationsKeyId: string;
  readonly operationsSecret: Uint8Array;
  readonly accessLifetimeMs?: number;
  readonly refreshLifetimeMs?: number;
}

export interface CollectSourceSessionValidator {
  isActive(sessionId: string, userId: string, now: Date): Promise<boolean>;
}

export class PostgresCollectBackendRepository implements CollectBackendRepository {
  public constructor(private readonly database: Database) {}

  public authorizeDevice(
    tenantId: VerifiedTenantId,
    input: Parameters<CollectBackendRepository['authorizeDevice']>[1],
  ) {
    return authorizeCollectDevice(this.database, tenantId, input);
  }

  public authenticateAccessToken(accessTokenDigest: Uint8Array) {
    return authenticateCollectAccessToken(this.database, accessTokenDigest);
  }

  public rotateTokens(input: Parameters<CollectBackendRepository['rotateTokens']>[0]) {
    return rotateCollectTokens(this.database, input);
  }

  public readBootstrap(
    device: CollectDeviceIdentity,
    authorization: SignedOperationsDatabaseContext,
  ) {
    return readCollectBootstrap(this.database, device, authorization);
  }

  public readDelta(
    device: CollectDeviceIdentity,
    authorization: SignedOperationsDatabaseContext,
    afterCursor: number,
    limit: number,
  ) {
    return readCollectDelta(this.database, device, authorization, afterCursor, limit);
  }

  public sync(input: Parameters<CollectBackendRepository['sync']>[0]) {
    return syncCollectOperations(this.database, input);
  }

  public approveDiscrepancy(
    tenantId: VerifiedTenantId,
    input: Parameters<CollectBackendRepository['approveDiscrepancy']>[1],
  ) {
    return approveCollectDiscrepancy(this.database, tenantId, input);
  }
}

export class CollectTokenInvalidError extends Error {
  public readonly statusCode = 401;
  public constructor() {
    super('The Collect device token is expired, revoked, or invalid.');
    this.name = 'CollectTokenInvalidError';
  }
}

export class CollectApiService {
  private readonly accessLifetimeMs: number;
  private readonly refreshLifetimeMs: number;

  public constructor(
    private readonly repository: CollectBackendRepository,
    private readonly sourceSessions: CollectSourceSessionValidator,
    private readonly config: CollectServiceConfig,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (config.operationsSecret.byteLength < 32)
      throw new RangeError('Collect requires a 32-byte Operations signing secret.');
    this.accessLifetimeMs = config.accessLifetimeMs ?? 10 * 60_000;
    this.refreshLifetimeMs = config.refreshLifetimeMs ?? 14 * 24 * 60 * 60_000;
    if (this.accessLifetimeMs < 60_000 || this.accessLifetimeMs > 15 * 60_000)
      throw new RangeError('Collect access lifetime must be 1-15 minutes.');
    if (
      this.refreshLifetimeMs <= this.accessLifetimeMs ||
      this.refreshLifetimeMs > 30 * 24 * 60 * 60_000
    ) {
      throw new RangeError(
        'Collect refresh lifetime must exceed access and be no longer than 30 days.',
      );
    }
  }

  public async authorizeDevice(
    tenantId: VerifiedTenantId,
    input: CollectRequestContext & {
      readonly deviceLabel: string;
      readonly devicePublicKeyThumbprint: string;
      readonly mfaVerifiedAt: Date;
    },
  ) {
    const issuedAt = this.now();
    if (
      input.mfaVerifiedAt > issuedAt ||
      issuedAt.getTime() - input.mfaVerifiedAt.getTime() > 10 * 60_000
    ) {
      throw new CollectTokenInvalidError();
    }
    const accessToken = token('a1');
    const refreshToken = token('r1');
    const accessExpiresAt = new Date(issuedAt.getTime() + this.accessLifetimeMs);
    const refreshExpiresAt = new Date(issuedAt.getTime() + this.refreshLifetimeMs);
    const scopes = [
      'assignments:read',
      'payments:create',
      'reconciliations:submit',
      'receipts:print:audit',
    ] as const;
    const authorization = this.sign(
      tenantId,
      input,
      'tenant.collection.view',
      'tenant.collect.device.authorize',
      `collect-device:${input.requestId}`,
      'Authorize a collector-owned device after fresh MFA.',
    );
    const device = await this.repository.authorizeDevice(tenantId, {
      authorization,
      collectorUserId: input.actorId,
      sourceSessionId: input.sessionId,
      deviceLabel: input.deviceLabel,
      devicePublicKeyThumbprint: input.devicePublicKeyThumbprint,
      mfaVerifiedAt: input.mfaVerifiedAt,
      accessTokenDigest: digest(accessToken),
      refreshTokenDigest: digest(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      scopes,
    });
    return {
      device,
      accessToken,
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      tokenType: 'Bearer' as const,
    };
  }

  public async authenticate(accessToken: string): Promise<CollectDeviceIdentity> {
    if (!/^orvex_collect_a1\.[A-Za-z0-9_-]{43}$/.test(accessToken))
      throw new CollectTokenInvalidError();
    const device = await this.repository.authenticateAccessToken(digest(accessToken));
    if (!device) throw new CollectTokenInvalidError();
    await this.assertSourceSession(device);
    return device;
  }

  public async refresh(presentedRefreshToken: string) {
    if (!/^orvex_collect_r1\.[A-Za-z0-9_-]{43}$/.test(presentedRefreshToken))
      throw new CollectTokenInvalidError();
    const issuedAt = this.now();
    const accessToken = token('a1');
    const refreshToken = token('r1');
    const accessExpiresAt = new Date(issuedAt.getTime() + this.accessLifetimeMs);
    const refreshExpiresAt = new Date(issuedAt.getTime() + this.refreshLifetimeMs);
    const device = await this.repository.rotateTokens({
      presentedRefreshTokenDigest: digest(presentedRefreshToken),
      accessTokenDigest: digest(accessToken),
      refreshTokenDigest: digest(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    });
    if (!device) throw new CollectTokenInvalidError();
    await this.assertSourceSession(device);
    return {
      device,
      accessToken,
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      tokenType: 'Bearer' as const,
    };
  }

  public readBootstrap(
    device: CollectDeviceIdentity,
    context: Omit<CollectRequestContext, 'actorId' | 'sessionId'>,
  ) {
    return this.repository.readBootstrap(
      device,
      this.signDevice(
        device,
        context,
        'tenant.collection.view',
        'tenant.collect.assignments.read',
        `collect-bootstrap:${context.requestId}`,
      ),
    );
  }

  public readDelta(
    device: CollectDeviceIdentity,
    context: Omit<CollectRequestContext, 'actorId' | 'sessionId'>,
    afterCursor: number,
    limit: number,
  ) {
    return this.repository.readDelta(
      device,
      this.signDevice(
        device,
        context,
        'tenant.collection.view',
        'tenant.collect.assignments.read',
        `collect-delta:${device.deviceId}:${afterCursor}`,
      ),
      afterCursor,
      limit,
    );
  }

  public sync(
    device: CollectDeviceIdentity,
    context: Omit<CollectRequestContext, 'actorId' | 'sessionId'>,
    operations: readonly CollectSyncOperation[],
  ) {
    if (operations.length < 1 || operations.length > 100)
      throw new RangeError('Collect sync batches contain 1-100 operations.');
    const ids = new Set<string>();
    for (const operation of operations) {
      if (ids.has(operation.operationId))
        throw new RangeError('Collect operation identifiers must be unique per batch.');
      ids.add(operation.operationId);
    }
    const payloadHashes = Object.fromEntries(
      operations.map((operation) => [operation.operationId, payloadHash(operation)]),
    );
    return this.repository.sync({
      authorization: this.signDevice(
        device,
        context,
        'tenant.payment.post',
        'tenant.collection.evidence.record',
        `collect-sync:${device.deviceId}:${operations[0]!.operationId}`,
      ),
      device,
      operations,
      payloadHashes,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      serverReceivedAt: this.now(),
    });
  }

  public approveDiscrepancy(
    tenantId: VerifiedTenantId,
    context: CollectRequestContext & {
      readonly reconciliationId: string;
      readonly reason: string;
      readonly idempotencyKey: string;
    },
  ) {
    return this.repository.approveDiscrepancy(tenantId, {
      authorization: this.sign(
        tenantId,
        context,
        'tenant.collection.reconcile',
        'tenant.collect.reconciliation.discrepancy.approve',
        context.idempotencyKey,
        'Independent manager approval of a collector reconciliation discrepancy.',
      ),
      reconciliationId: context.reconciliationId,
      approverUserId: context.actorId,
      reason: context.reason,
      idempotencyKey: context.idempotencyKey,
    });
  }

  private signDevice(
    device: CollectDeviceIdentity,
    context: Omit<CollectRequestContext, 'actorId' | 'sessionId'>,
    permission: Permission,
    action: string,
    idempotencyKey: string,
  ) {
    return this.sign(
      device.tenantId,
      { ...context, actorId: device.collectorUserId, sessionId: device.sessionId },
      permission,
      action,
      idempotencyKey,
      'Authorized Orvex ISP Collect device request.',
    );
  }

  private async assertSourceSession(device: CollectDeviceIdentity): Promise<void> {
    if (
      !(await this.sourceSessions.isActive(device.sessionId, device.collectorUserId, this.now()))
    ) {
      throw new CollectTokenInvalidError();
    }
  }

  private sign(
    tenantId: VerifiedTenantId,
    context: CollectRequestContext,
    permission: Permission,
    action: string,
    idempotencyKey: string,
    reason: string,
  ): SignedOperationsDatabaseContext {
    const attestation: OperationsAttestation = {
      keyId: this.config.operationsKeyId,
      tenantId,
      actorId: context.actorId,
      sessionId: context.sessionId,
      permission,
      action,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      reason,
      idempotencyKey,
      ...(context.branchIds !== undefined ? { branchIds: context.branchIds } : {}),
      ...(context.areaIds !== undefined ? { areaIds: context.areaIds } : {}),
      ...(context.routeIds !== undefined ? { routeIds: context.routeIds } : {}),
      ...(context.recordIds !== undefined ? { recordIds: context.recordIds } : {}),
      expiresAt: new Date(this.now().getTime() + 60_000).toISOString(),
    };
    return signOperationsAttestation(attestation, this.config.operationsSecret);
  }
}

function token(kind: 'a1' | 'r1'): string {
  return `orvex_collect_${kind}.${randomBytes(32).toString('base64url')}`;
}
function digest(value: string): Uint8Array {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function canonicalCollectJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCollectJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalCollectJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function payloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalCollectJson(value), 'utf8').digest('hex');
}
