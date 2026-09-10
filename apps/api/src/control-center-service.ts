import {
  integrationTestCommandSchema,
  platformIntegrationConfigureBodySchema,
  type IntegrationKind,
  type Permission,
} from '@isp/contracts';
import {
  allocatePlatformPayment,
  configurePlatformIntegration,
  readPlatformIntegrationSettings,
  recordPlatformIntegrationTest,
  approveControlSubscriptionTransition,
  assignControlSubscription,
  createControlClient,
  createControlClientContact,
  createControlPackageVersion,
  listControlClients,
  readControlAudit,
  readControlBilling,
  readControlClientDetail,
  readControlPackages,
  readControlPortfolio,
  readControlSubscriptions,
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
  type StoredIntegrationDelivery,
} from '@isp/database';
import { createHash } from 'node:crypto';
import { integrationTestMail, integrationTestText } from './integrations/mail-templates.js';
import {
  performIntegrationTest,
  prepareIntegrationConfiguration,
  type IntegrationRuntime,
} from './integrations/runtime.js';
import type { ControlCenterApiService } from './routes/control-center/index.js';

/** Runtime-role reader for the stored provider settings the platform tests against. */
export interface PlatformIntegrationReader {
  readIntegration(kind: IntegrationKind): Promise<StoredIntegrationDelivery | null>;
}

export interface ControlCenterIntegrationDependencies {
  readonly runtime: IntegrationRuntime;
  readonly store: PlatformIntegrationReader;
}

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
    private readonly integrations?: ControlCenterIntegrationDependencies,
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

  public readPortfolio(context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readControlPortfolio(
      this.database,
      this.readSignature(request, {}, 'Read the Control Center portfolio snapshot.'),
    );
  }
  public readClientDetail(input: Record<string, unknown>, context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readControlClientDetail(
      this.database,
      this.readSignature(request, input, 'Read a Control Center client file.'),
      text(input, 'tenantId'),
    );
  }
  public readPackages(context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readControlPackages(
      this.database,
      this.readSignature(request, {}, 'Read Control Center package versions.'),
    );
  }
  public readSubscriptions(context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readControlSubscriptions(
      this.database,
      this.readSignature(request, {}, 'Read Control Center subscriptions.'),
    );
  }
  public readBilling(input: Record<string, unknown>, context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readControlBilling(
      this.database,
      this.readSignature(request, input, 'Read the platform billing ledger.'),
      typeof input.limit === 'number' ? input.limit : 200,
    );
  }
  public readAudit(input: Record<string, unknown>, context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readControlAudit(
      this.database,
      this.readSignature(request, input, 'Read the Control Center audit trail.'),
      {
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(typeof input.before === 'string' ? { before: input.before } : {}),
      },
    );
  }
  private readSignature(request: RequestContext, input: unknown, reason: string) {
    return this.sign(request, {
      idempotencyKey: `read-${request.requestId}`,
      requestHash: hashCanonical(input),
      reason,
    });
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

  public readIntegrations(context: Record<string, unknown>) {
    const request = readRequestContext(context);
    return readPlatformIntegrationSettings(
      this.database,
      this.sign(request, {
        idempotencyKey: `read-${request.requestId}`,
        requestHash: hashCanonical({}),
        reason: 'Read platform integration settings.',
      }),
    );
  }

  public configureIntegration(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    const runtime = this.requireIntegrations().runtime;
    const body = platformIntegrationConfigureBodySchema.parse({
      kind: input.kind,
      config: input.config,
      ...(input.secrets !== undefined ? { secrets: input.secrets } : {}),
      keepSecrets: input.keepSecrets ?? false,
      active: input.active ?? true,
      ...(typeof input.expectedVersion === 'number'
        ? { expectedVersion: input.expectedVersion }
        : {}),
      reason: request.reason,
    });
    const prepared = prepareIntegrationConfiguration(runtime, {
      kind: body.kind,
      config: body.config,
      ...(body.secrets ? { secrets: body.secrets } : {}),
      keepSecrets: body.keepSecrets,
      active: body.active,
      ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
    });
    // The route hashed the body without secrets; bind the keyed credential fingerprint into the
    // signed request identity so a retry with different credentials is a different request.
    const bound: MutationContext = {
      ...request,
      requestHash: hashCanonical({
        base: request.requestHash,
        fingerprint: prepared.cipherFingerprint ?? null,
      }),
    };
    return configurePlatformIntegration(this.database, {
      ...bound,
      authorization: this.sign(bound),
      kind: prepared.kind,
      config: prepared.config,
      active: prepared.active,
      ...(prepared.secretCiphertext ? { secretCiphertext: prepared.secretCiphertext } : {}),
      ...(prepared.cipherKeyId ? { cipherKeyId: prepared.cipherKeyId } : {}),
      protectedFields: prepared.protectedFields,
      keepSecrets: prepared.keepSecrets,
      ...(prepared.expectedVersion !== undefined
        ? { expectedVersion: prepared.expectedVersion }
        : {}),
    });
  }

  public async testIntegration(input: Record<string, unknown>) {
    const request = readMutationContext(input);
    const { runtime, store } = this.requireIntegrations();
    const body = integrationTestCommandSchema
      .pick({ kind: true, recipient: true })
      .parse({ kind: input.kind, recipient: input.recipient });
    const stored = await store.readIntegration(body.kind);
    const occurredAt = this.now();
    const outcome = stored
      ? await performIntegrationTest(runtime, stored, body.recipient, {
          mail: integrationTestMail({
            scope: 'platform',
            requestedBy: request.actorId,
            occurredAt,
          }),
          text: integrationTestText({ scope: 'platform', occurredAt }),
        })
      : {
          status: 'failed' as const,
          message: `No active ${body.kind} settings are configured.`,
          recipientMasked: body.recipient,
          errorCode: 'NOT_CONFIGURED',
        };
    return recordPlatformIntegrationTest(this.database, {
      ...request,
      authorization: this.sign(request),
      kind: body.kind,
      status: outcome.status,
      message: outcome.message,
      recipientMasked: outcome.recipientMasked,
      ...(outcome.providerReference ? { providerReference: outcome.providerReference } : {}),
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
    });
  }

  private requireIntegrations(): ControlCenterIntegrationDependencies {
    if (!this.integrations) {
      throw new Error('Integration settings are not available in this Control Center runtime.');
    }
    return this.integrations;
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
