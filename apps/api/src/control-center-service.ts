import type { Permission } from '@isp/contracts';
import {
  allocatePlatformPayment,
  approveControlSubscriptionTransition,
  assignControlSubscription,
  createControlClient,
  createControlClientContact,
  createControlPackageVersion,
  listControlClients,
  postPlatformInvoice,
  postPlatformPayment,
  reversePlatformAllocation,
  reversePlatformInvoice,
  reversePlatformPayment,
  signControlContext,
  transitionControlSubscription,
  type ControlContextAttestation,
  type Database,
  type DrilldownQuery,
  type SignedControlDatabaseContext,
} from '@isp/database';
import { createHash } from 'node:crypto';
import type { ControlCenterApiService } from './routes/control-center/index.js';

interface RequestContext extends Record<string, unknown> {
  readonly actorId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly permission: Permission;
  readonly action: string;
  readonly userAgent?: string;
  readonly mfaVerifiedAt?: Date;
}

interface MutationContext extends RequestContext {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly reason: string;
}

export interface ControlContextAuthorityConfig {
  readonly keyId: string;
  readonly secret: Uint8Array;
}

export function decodeControlContextSecret(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error('CONTROL_CONTEXT_SECRET_BASE64 must be canonical base64.');
  }
  const secret = Buffer.from(normalized, 'base64');
  if (secret.byteLength < 32) {
    throw new Error('CONTROL_CONTEXT_SECRET_BASE64 must decode to at least 32 bytes.');
  }
  return secret;
}

export class PostgresControlCenterService implements ControlCenterApiService {
  public constructor(
    private readonly database: Database,
    private readonly authority: ControlContextAuthorityConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public listClients(input: Record<string, unknown>, context: Record<string, unknown>) {
    const request = readRequestContext(context);
    const requestHash = hashCanonical(input);
    return listControlClients(
      this.database,
      this.sign(request, {
        idempotencyKey: `read-${request.requestId}`,
        requestHash,
        reason: 'Read Control Center client work queue.',
      }),
      input as unknown as DrilldownQuery,
    );
  }

  public createClient(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    return createControlClient(this.database, {
      ...request,
      authorization: this.sign(request),
      tenantId: text(input, 'tenantId'),
      legalName: text(input, 'legalName'),
      tradingName: text(input, 'tradingName'),
      ...optionalText(input, 'registrationNumber'),
      ...optionalText(input, 'accountOwnerId'),
      ...optionalText(input, 'notes'),
    });
  }

  public createContact(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    return createControlClientContact(this.database, {
      ...request,
      authorization: this.sign(request),
      tenantId: text(input, 'tenantId'),
      role: text(input, 'role') as 'primary' | 'billing' | 'technical' | 'legal',
      name: text(input, 'name'),
      ...optionalText(input, 'email'),
      ...optionalText(input, 'phone'),
      preferredLocale: text(input, 'preferredLocale') as 'en' | 'ar',
      isPrimary: boolean(input, 'isPrimary'),
    });
  }

  public createPackageVersion(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    return createControlPackageVersion(this.database, {
      ...request,
      authorization: this.sign(request),
      packageKey: text(input, 'packageKey'),
      version: number(input, 'version'),
      nameEn: text(input, 'nameEn'),
      nameAr: text(input, 'nameAr'),
      entitlements: input.entitlements as readonly string[],
      priceMinor: number(input, 'priceMinor'),
      currency: text(input, 'currency') as 'USD' | 'LBP',
      effectiveFrom: date(input, 'effectiveFrom'),
      ...optionalDate(input, 'effectiveUntil'),
    });
  }

  public assignSubscription(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    return assignControlSubscription(this.database, {
      ...request,
      authorization: this.sign(request),
      tenantId: text(input, 'tenantId'),
      packageVersionId: text(input, 'packageVersionId'),
      state: text(input, 'state') as Parameters<typeof assignControlSubscription>[1]['state'],
      startsAt: date(input, 'startsAt'),
      ...(typeof input.expectedRevision === 'number'
        ? { expectedRevision: input.expectedRevision }
        : {}),
    });
  }

  public transitionSubscription(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    return transitionControlSubscription(this.database, {
      ...request,
      authorization: this.sign(request),
      tenantId: text(input, 'tenantId'),
      expectedState: text(input, 'expectedState') as Parameters<
        typeof transitionControlSubscription
      >[1]['expectedState'],
      expectedRevision: number(input, 'expectedRevision'),
      toState: text(input, 'toState') as Parameters<
        typeof transitionControlSubscription
      >[1]['toState'],
    });
  }

  public approveTransition(input: Record<string, unknown>) {
    return this.mutation(input, (request, authorization) =>
      approveControlSubscriptionTransition(this.database, {
        ...request,
        authorization,
        approvalRequestId: text(input, 'approvalRequestId'),
      }),
    );
  }

  public postInvoice(input: Record<string, unknown>) {
    return this.postDocument(input, postPlatformInvoice);
  }

  public postPayment(input: Record<string, unknown>) {
    return this.postDocument(input, postPlatformPayment);
  }

  public reverseInvoice(input: Record<string, unknown>) {
    return this.reverseDocument(input, reversePlatformInvoice);
  }

  public reversePayment(input: Record<string, unknown>) {
    return this.reverseDocument(input, reversePlatformPayment);
  }

  public allocatePayment(input: Record<string, unknown>) {
    return this.mutation(input, (request, authorization) =>
      allocatePlatformPayment(this.database, {
        ...request,
        authorization,
        tenantId: text(input, 'tenantId'),
        invoiceId: text(input, 'invoiceId'),
        paymentId: text(input, 'paymentId'),
        amountMinor: number(input, 'amountMinor'),
        currency: text(input, 'currency') as 'USD' | 'LBP',
      }),
    );
  }

  public reverseAllocation(input: Record<string, unknown>) {
    return this.mutation(input, (request, authorization) =>
      reversePlatformAllocation(this.database, {
        ...request,
        authorization,
        tenantId: text(input, 'tenantId'),
        originalId: text(input, 'originalId'),
      }),
    );
  }

  private postDocument(
    input: Record<string, unknown>,
    writer: typeof postPlatformInvoice | typeof postPlatformPayment,
  ) {
    return this.mutation(input, (request, authorization) =>
      writer(this.database, {
        ...request,
        authorization,
        tenantId: text(input, 'tenantId'),
        number: text(input, 'number'),
        amountMinor: number(input, 'amountMinor'),
        currency: text(input, 'currency') as 'USD' | 'LBP',
        ...optionalDate(input, 'dueAt'),
      }),
    );
  }

  private reverseDocument(
    input: Record<string, unknown>,
    writer: typeof reversePlatformInvoice | typeof reversePlatformPayment,
  ) {
    return this.mutation(input, (request, authorization) =>
      writer(this.database, {
        ...request,
        authorization,
        tenantId: text(input, 'tenantId'),
        originalId: text(input, 'originalId'),
        number: text(input, 'number'),
      }),
    );
  }

  private mutation<T>(
    input: Record<string, unknown>,
    work: (request: MutationContext, authorization: SignedControlDatabaseContext) => T,
  ): T {
    const request = readMutationContext(input);
    return work(request, this.sign(request));
  }

  private sign(
    request: RequestContext,
    mutation?: Pick<MutationContext, 'idempotencyKey' | 'requestHash' | 'reason'>,
  ): SignedControlDatabaseContext {
    const now = this.now();
    const source = mutation ?? (request as MutationContext);
    const attestation: ControlContextAttestation = {
      keyId: this.authority.keyId,
      actorId: request.actorId,
      sessionId: request.sessionId,
      permission: request.permission,
      action: request.action,
      requestId: request.requestId,
      requestHash: source.requestHash,
      idempotencyKey: source.idempotencyKey,
      ipAddress: request.ipAddress,
      ...(request.userAgent ? { userAgent: request.userAgent } : {}),
      reason: source.reason,
      ...(request.mfaVerifiedAt ? { mfaVerifiedAt: request.mfaVerifiedAt.toISOString() } : {}),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    };
    return signControlContext(attestation, this.authority.secret);
  }
}

function readRequestContext(input: Record<string, unknown>): RequestContext {
  return {
    ...input,
    actorId: text(input, 'actorId'),
    sessionId: text(input, 'sessionId'),
    requestId: text(input, 'requestId'),
    ipAddress: text(input, 'ipAddress'),
    permission: text(input, 'permission') as Permission,
    action: text(input, 'action'),
    ...optionalText(input, 'userAgent'),
    ...(input.mfaVerifiedAt instanceof Date ? { mfaVerifiedAt: input.mfaVerifiedAt } : {}),
  };
}

function readMutationContext(input: Record<string, unknown>): MutationContext {
  return {
    ...readRequestContext(input),
    idempotencyKey: text(input, 'idempotencyKey'),
    requestHash: text(input, 'requestHash'),
    reason: text(input, 'reason'),
  };
}

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${key} is required.`);
  return value;
}
function number(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== 'number') throw new TypeError(`${key} is required.`);
  return value;
}
function boolean(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  if (typeof value !== 'boolean') throw new TypeError(`${key} is required.`);
  return value;
}
function date(input: Record<string, unknown>, key: string): Date {
  return new Date(text(input, key));
}
function optionalText(input: Record<string, unknown>, key: string): Record<string, string> {
  return typeof input[key] === 'string' ? { [key]: input[key] } : {};
}
function optionalDate(input: Record<string, unknown>, key: string): Record<string, Date> {
  return typeof input[key] === 'string' ? { [key]: new Date(input[key]) } : {};
}
function hashCanonical(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
