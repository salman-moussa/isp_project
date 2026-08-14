import type { VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from '../operations/context.js';
import type { SignedOperationsDatabaseContext } from '../operations/types.js';
import { safeCollectInteger } from './canonical.js';
import type {
  ApproveCollectDiscrepancyInput,
  AuthorizeCollectDeviceInput,
  CollectAssignment,
  CollectDeviceIdentity,
  CollectSyncEnvelope,
  CollectSyncOperation,
  CollectSyncResult,
  RotateCollectTokensInput,
} from './types.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class CollectAuthorizationError extends Error {
  public readonly code = 'COLLECT_AUTHORIZATION_DENIED';
  public constructor(message = 'Collect device authorization was denied.') {
    super(message);
    this.name = 'CollectAuthorizationError';
  }
}

export class CollectConflictError extends Error {
  public readonly code = 'COLLECT_CONFLICT';
  public constructor(
    message = 'Collect state changed or an operation conflicts with prior evidence.',
  ) {
    super(message);
    this.name = 'CollectConflictError';
  }
}

export class CollectValidationError extends Error {
  public readonly code = 'COLLECT_VALIDATION_FAILED';
  public constructor(message: string) {
    super(message);
    this.name = 'CollectValidationError';
  }
}

export async function authorizeCollectDevice(
  database: Database,
  tenantId: VerifiedTenantId,
  input: AuthorizeCollectDeviceInput,
): Promise<CollectDeviceIdentity> {
  return collectErrors(() =>
    inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
      const [device] = await transaction.execute<{
        readonly id: string;
        readonly tenant_id: string;
        readonly collector_user_id: string;
        readonly source_session_id: string;
        readonly access_expires_at: Date | string;
        readonly scopes: string[];
      }>(sql`
        INSERT INTO collect_devices (
          tenant_id, collector_user_id, source_session_id, device_label,
          device_public_key_thumbprint, mfa_verified_at, access_token_digest,
          refresh_token_digest, access_expires_at, refresh_expires_at, scopes
        )
        SELECT ${tenantId}, membership.user_id, ${input.sourceSessionId}::uuid,
          ${input.deviceLabel}, ${input.devicePublicKeyThumbprint},
          ${input.mfaVerifiedAt.toISOString()}::timestamptz,
          decode(${hex(input.accessTokenDigest)}, 'hex'), decode(${hex(input.refreshTokenDigest)}, 'hex'),
          ${input.accessExpiresAt.toISOString()}::timestamptz,
          ${input.refreshExpiresAt.toISOString()}::timestamptz,
          ${array(input.scopes)}
        FROM tenant_memberships membership
        JOIN users identity ON identity.id = membership.user_id
        WHERE membership.tenant_id = ${tenantId}
          AND membership.user_id = ${input.collectorUserId}::uuid
          AND membership.active AND identity.disabled_at IS NULL
          AND membership.role_key = 'collector'
          AND membership.permissions @> ARRAY['tenant.collection.view','tenant.payment.post']::text[]
          AND ${input.mfaVerifiedAt.toISOString()}::timestamptz >= clock_timestamp() - interval '10 minutes'
          AND ${input.mfaVerifiedAt.toISOString()}::timestamptz <= clock_timestamp()
        RETURNING id, tenant_id, collector_user_id, source_session_id, access_expires_at, scopes
      `);
      if (!device)
        throw new CollectAuthorizationError(
          'A current collector membership and fresh MFA are required.',
        );
      await appendCollectAudit(transaction, {
        tenantId,
        action: 'tenant.collect.device.authorize',
        resourceType: 'collect_device',
        resourceId: device.id,
        result: { status: 'active', scopes: device.scopes },
      });
      return mapDevice(device);
    }),
  );
}

/** Owner-mediated lookup returns identity metadata only; raw tokens are never stored. */
export async function authenticateCollectAccessToken(
  database: Database,
  accessTokenDigest: Uint8Array,
): Promise<CollectDeviceIdentity | null> {
  return collectErrors(async () => {
    const [row] = await database.execute<{
      readonly device_id: string;
      readonly tenant_id: string;
      readonly collector_user_id: string;
      readonly source_session_id: string;
      readonly scopes: string[];
      readonly access_expires_at: Date | string;
    }>(sql`SELECT * FROM authenticate_collect_device(decode(${hex(accessTokenDigest)}, 'hex'))`);
    if (!row) return null;
    return {
      deviceId: row.device_id,
      tenantId: row.tenant_id as VerifiedTenantId,
      collectorUserId: row.collector_user_id,
      sessionId: row.source_session_id,
      scopes: row.scopes as CollectDeviceIdentity['scopes'],
      accessExpiresAt: new Date(row.access_expires_at).toISOString(),
    };
  });
}

export async function rotateCollectTokens(
  database: Database,
  input: RotateCollectTokensInput,
): Promise<CollectDeviceIdentity | null> {
  return collectErrors(async () => {
    const [row] = await database.execute<{
      readonly device_id: string;
      readonly tenant_id: string;
      readonly collector_user_id: string;
      readonly source_session_id: string;
      readonly scopes: string[];
      readonly access_expires_at: Date | string;
    }>(sql`
      SELECT * FROM rotate_collect_device_tokens(
        decode(${hex(input.presentedRefreshTokenDigest)}, 'hex'),
        decode(${hex(input.accessTokenDigest)}, 'hex'),
        decode(${hex(input.refreshTokenDigest)}, 'hex'),
        ${input.accessExpiresAt.toISOString()}::timestamptz,
        ${input.refreshExpiresAt.toISOString()}::timestamptz
      )
    `);
    if (!row) return null;
    return {
      deviceId: row.device_id,
      tenantId: row.tenant_id as VerifiedTenantId,
      collectorUserId: row.collector_user_id,
      sessionId: row.source_session_id,
      scopes: row.scopes as CollectDeviceIdentity['scopes'],
      accessExpiresAt: new Date(row.access_expires_at).toISOString(),
    };
  });
}

export async function readCollectBootstrap(
  database: Database,
  device: CollectDeviceIdentity,
  authorization: SignedOperationsDatabaseContext,
): Promise<{
  readonly cursor: number;
  readonly serverTime: string;
  readonly assignments: readonly CollectAssignment[];
}> {
  return collectErrors(() =>
    inOperationsTransaction(database, device.tenantId, authorization, async (transaction) => {
      await assertDevice(transaction, device);
      const assignments = await currentAssignments(transaction, device);
      const [cursor] = await transaction.execute<{ readonly cursor: string }>(sql`
        SELECT coalesce(max(change_id), 0)::text AS cursor
        FROM collect_assignment_changes
        WHERE tenant_id = ${device.tenantId} AND collector_user_id = ${device.collectorUserId}::uuid
      `);
      return {
        cursor: safeCollectInteger(cursor?.cursor ?? '0'),
        serverTime: new Date().toISOString(),
        assignments,
      };
    }),
  );
}

export async function readCollectDelta(
  database: Database,
  device: CollectDeviceIdentity,
  authorization: SignedOperationsDatabaseContext,
  afterCursor: number,
  limit: number,
): Promise<{
  readonly cursor: number;
  readonly hasMore: boolean;
  readonly serverTime: string;
  readonly assignments: readonly CollectAssignment[];
  readonly removedAssignmentIds: readonly string[];
}> {
  if (!Number.isSafeInteger(afterCursor) || afterCursor < 0)
    throw new CollectValidationError('Invalid delta cursor.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new CollectValidationError('Delta limit must be between 1 and 500.');
  return collectErrors(() =>
    inOperationsTransaction(database, device.tenantId, authorization, async (transaction) => {
      await assertDevice(transaction, device);
      const changes = await transaction.execute<{
        readonly change_id: string;
        readonly assignment_id: string;
        readonly visible: boolean;
      }>(sql`
        SELECT change_id::text, assignment_id, visible
        FROM collect_assignment_changes
        WHERE tenant_id = ${device.tenantId} AND collector_user_id = ${device.collectorUserId}::uuid
          AND change_id > ${afterCursor}
        ORDER BY change_id
        LIMIT ${limit + 1}
      `);
      const page = changes.slice(0, limit);
      const ids = [
        ...new Set(page.filter((change) => change.visible).map((change) => change.assignment_id)),
      ];
      const assignments = ids.length ? await currentAssignments(transaction, device, ids) : [];
      const visibleIds = new Set(assignments.map((assignment) => assignment.assignmentId));
      const removedAssignmentIds = [
        ...new Set(
          page
            .filter((change) => !change.visible || !visibleIds.has(change.assignment_id))
            .map((change) => change.assignment_id),
        ),
      ];
      return {
        cursor: page.length ? safeCollectInteger(page.at(-1)!.change_id) : afterCursor,
        hasMore: changes.length > limit,
        serverTime: new Date().toISOString(),
        assignments,
        removedAssignmentIds,
      };
    }),
  );
}

export async function syncCollectOperations(
  database: Database,
  envelope: CollectSyncEnvelope,
): Promise<readonly CollectSyncResult[]> {
  if (envelope.operations.length < 1 || envelope.operations.length > 100) {
    throw new CollectValidationError('A sync batch must contain between 1 and 100 operations.');
  }
  for (let index = 1; index < envelope.operations.length; index += 1) {
    if (envelope.operations[index]!.sequence !== envelope.operations[index - 1]!.sequence + 1) {
      throw new CollectValidationError('Sync operations must be ordered and contiguous.');
    }
  }
  return collectErrors(() =>
    inOperationsTransaction(
      database,
      envelope.device.tenantId,
      envelope.authorization,
      async (transaction) => {
        await assertDevice(transaction, envelope.device, true);
        await installFinanceAuditContext(transaction);
        const results: CollectSyncResult[] = [];
        for (const operation of envelope.operations) {
          const payloadHash = envelope.payloadHashes[operation.operationId];
          if (!/^[a-f0-9]{64}$/.test(payloadHash ?? ''))
            throw new CollectValidationError('A canonical SHA-256 payload hash is required.');
          const [existing] = await transaction.execute<{
            readonly sequence: string;
            readonly operation_type: CollectSyncOperation['type'];
            readonly payload_hash: string;
            readonly result: Readonly<Record<string, unknown>>;
            readonly server_recorded_at: Date | string;
          }>(sql`
          SELECT sequence::text, operation_type, payload_hash, result, server_recorded_at
          FROM collect_sync_operations
          WHERE tenant_id = ${envelope.device.tenantId} AND device_id = ${envelope.device.deviceId}::uuid
            AND operation_id = ${operation.operationId}::uuid
        `);
          if (existing) {
            if (
              existing.sequence !== String(operation.sequence) ||
              existing.operation_type !== operation.type ||
              existing.payload_hash !== payloadHash
            ) {
              throw new CollectConflictError(
                'The operation identity was replayed with changed content.',
              );
            }
            results.push({
              operationId: operation.operationId,
              sequence: safeCollectInteger(existing.sequence),
              type: existing.operation_type,
              replayed: true,
              serverRecordedAt: new Date(existing.server_recorded_at).toISOString(),
              result: existing.result,
            });
            continue;
          }
          const [state] = await transaction.execute<{ readonly last_sequence: string }>(sql`
          SELECT last_sequence::text FROM collect_devices
          WHERE tenant_id = ${envelope.device.tenantId} AND id = ${envelope.device.deviceId}::uuid
          FOR UPDATE
        `);
          if (!state || safeCollectInteger(state.last_sequence) + 1 !== operation.sequence) {
            throw new CollectConflictError(
              'The device sequence has a gap or stale unordered operation.',
            );
          }
          const serverRecordedAt = envelope.serverReceivedAt;
          const result = await executeOperation(transaction, envelope, operation, serverRecordedAt);
          await transaction.execute(sql`
          INSERT INTO collect_sync_operations (
            tenant_id, device_id, operation_id, sequence, operation_type, payload_hash,
            payload, result, server_recorded_at
          ) VALUES (
            ${envelope.device.tenantId}, ${envelope.device.deviceId}::uuid,
            ${operation.operationId}::uuid, ${operation.sequence}, ${operation.type}, ${payloadHash},
            ${JSON.stringify(operation.payload)}::jsonb, ${JSON.stringify(result)}::jsonb,
            ${serverRecordedAt.toISOString()}::timestamptz
          )
        `);
          await transaction.execute(sql`
          UPDATE collect_devices SET last_sequence = ${operation.sequence}, last_seen_at = clock_timestamp()
          WHERE tenant_id = ${envelope.device.tenantId} AND id = ${envelope.device.deviceId}::uuid
        `);
          results.push({
            operationId: operation.operationId,
            sequence: operation.sequence,
            type: operation.type,
            replayed: false,
            serverRecordedAt: serverRecordedAt.toISOString(),
            result,
          });
        }
        return results;
      },
    ),
  );
}

export async function approveCollectDiscrepancy(
  database: Database,
  tenantId: VerifiedTenantId,
  input: ApproveCollectDiscrepancyInput,
): Promise<{
  readonly reconciliationId: string;
  readonly approvedAt: string;
  readonly replayed: boolean;
}> {
  return collectErrors(() =>
    inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
      const [reconciliation] = await transaction.execute<{
        readonly collector_user_id: string;
        readonly status: string;
        readonly difference_minor: string;
      }>(sql`
        SELECT collector_user_id, status, difference_minor::text
        FROM collect_reconciliation_submissions
        WHERE tenant_id = ${tenantId} AND id = ${input.reconciliationId}::uuid FOR UPDATE
      `);
      if (!reconciliation || reconciliation.difference_minor === '0')
        throw new CollectConflictError('Only a pending discrepancy can be approved.');
      if (reconciliation.collector_user_id === input.approverUserId)
        throw new CollectAuthorizationError('The collector cannot approve their own discrepancy.');
      const [inserted] = await transaction.execute<{ readonly approved_at: Date | string }>(sql`
        INSERT INTO collect_reconciliation_approvals (
          tenant_id, reconciliation_id, approver_user_id, reason, idempotency_key
        )
        SELECT ${tenantId}, reconciliation.id, ${input.approverUserId}::uuid, ${input.reason}, ${input.idempotencyKey}
        FROM collect_reconciliation_submissions reconciliation
        JOIN tenant_memberships manager ON manager.tenant_id = reconciliation.tenant_id
          AND manager.user_id = ${input.approverUserId}::uuid AND manager.active
          AND manager.permissions @> ARRAY['tenant.collection.reconcile']::text[]
        WHERE reconciliation.tenant_id = ${tenantId} AND reconciliation.id = ${input.reconciliationId}::uuid
          AND reconciliation.status = 'pending_approval'
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING approved_at
      `);
      if (!inserted) {
        const [replay] = await transaction.execute<{
          readonly reconciliation_id: string;
          readonly approver_user_id: string;
          readonly reason: string;
          readonly approved_at: Date | string;
        }>(sql`
          SELECT reconciliation_id, approver_user_id, reason, approved_at
          FROM collect_reconciliation_approvals WHERE tenant_id = ${tenantId} AND idempotency_key = ${input.idempotencyKey}
        `);
        if (
          !replay ||
          replay.reconciliation_id !== input.reconciliationId ||
          replay.approver_user_id !== input.approverUserId ||
          replay.reason !== input.reason
        ) {
          throw new CollectConflictError(
            'The approval idempotency key belongs to different content.',
          );
        }
        return {
          reconciliationId: input.reconciliationId,
          approvedAt: new Date(replay.approved_at).toISOString(),
          replayed: true,
        };
      }
      await transaction.execute(sql`
        UPDATE collect_reconciliation_submissions SET status = 'approved'
        WHERE tenant_id = ${tenantId} AND id = ${input.reconciliationId}::uuid AND status = 'pending_approval'
      `);
      await appendCollectAudit(transaction, {
        tenantId,
        action: 'tenant.collect.reconciliation.discrepancy.approve',
        resourceType: 'collect_reconciliation',
        resourceId: input.reconciliationId,
        result: { approverUserId: input.approverUserId, reason: input.reason },
      });
      return {
        reconciliationId: input.reconciliationId,
        approvedAt: new Date(inserted.approved_at).toISOString(),
        replayed: false,
      };
    }),
  );
}

async function executeOperation(
  transaction: Transaction,
  envelope: CollectSyncEnvelope,
  operation: CollectSyncOperation,
  serverTime: Date,
): Promise<Readonly<Record<string, unknown>>> {
  if (operation.type === 'payment.create')
    return createPayment(transaction, envelope, operation, serverTime);
  if (operation.type === 'reconciliation.submit')
    return submitReconciliation(transaction, envelope, operation, serverTime);
  return auditReceiptPrint(transaction, envelope, operation, serverTime);
}

async function createPayment(
  transaction: Transaction,
  envelope: CollectSyncEnvelope,
  operation: Extract<CollectSyncOperation, { type: 'payment.create' }>,
  serverTime: Date,
) {
  const [assignment] = await transaction.execute<{
    readonly invoice_id: string;
    readonly currency: 'USD' | 'LBP';
    readonly outstanding_minor: string;
  }>(sql`
    SELECT assignment.finance_invoice_id AS invoice_id, assignment.currency,
      (invoice.amount_minor - guard.allocated_minor)::text AS outstanding_minor
    FROM operations_collector_assignments assignment
    JOIN finance_invoices invoice ON invoice.tenant_id = assignment.tenant_id AND invoice.id = assignment.finance_invoice_id
      AND invoice.entry_kind = 'posted'
    JOIN finance_document_guards guard ON guard.tenant_id = invoice.tenant_id
      AND guard.document_type = 'invoice' AND guard.document_id = invoice.id AND guard.reversed_at IS NULL
    WHERE assignment.tenant_id = ${envelope.device.tenantId} AND assignment.id = ${operation.payload.assignmentId}::uuid
      AND assignment.collector_user_id = ${envelope.device.collectorUserId}::uuid
      AND assignment.status IN ('assigned','visited','returned')
      AND NOT EXISTS (SELECT 1 FROM operations_collector_collection_evidence evidence
        WHERE evidence.tenant_id = assignment.tenant_id AND evidence.assignment_id = assignment.id)
    FOR UPDATE OF assignment, guard
  `);
  if (!assignment)
    throw new CollectConflictError('The assignment is no longer payable by this collector.');
  const outstanding = safeCollectInteger(assignment.outstanding_minor);
  if (
    operation.payload.currency !== assignment.currency ||
    operation.payload.amountMinor !== outstanding ||
    outstanding <= 0
  ) {
    throw new CollectConflictError(
      'The payment currency or amount no longer matches the current invoice balance.',
    );
  }
  const receiptNumber = `COL-${envelope.device.deviceId.slice(0, 8)}-${operation.operationId}`;
  const paymentKey = `collect-payment:${envelope.device.deviceId}:${operation.operationId}`;
  const allocationKey = `collect-allocation:${envelope.device.deviceId}:${operation.operationId}`;
  const [payment] = await transaction.execute<{ readonly id: string }>(sql`
    INSERT INTO finance_payments (
      tenant_id, receipt_number, entry_kind, amount_minor, currency,
      idempotency_key, actor_id, posted_at
    ) VALUES (
      ${envelope.device.tenantId}, ${receiptNumber}, 'posted', ${outstanding}, ${assignment.currency},
      ${paymentKey}, ${envelope.device.collectorUserId}, ${serverTime.toISOString()}::timestamptz
    ) RETURNING id
  `);
  if (!payment) throw new Error('Unable to post the Collect payment.');
  const [allocation] = await transaction.execute<{ readonly id: string }>(sql`
    INSERT INTO finance_payment_allocations (
      tenant_id, payment_id, invoice_id, entry_kind, amount_minor, currency,
      idempotency_key, actor_id, posted_at
    ) VALUES (
      ${envelope.device.tenantId}, ${payment.id}, ${assignment.invoice_id}, 'allocation',
      ${outstanding}, ${assignment.currency}, ${allocationKey},
      ${envelope.device.collectorUserId}, ${serverTime.toISOString()}::timestamptz
    ) RETURNING id
  `);
  if (!allocation) throw new Error('Unable to allocate the Collect payment.');
  const [evidence] = await transaction.execute<{ readonly id: string }>(sql`
    INSERT INTO operations_collector_collection_evidence (
      tenant_id, assignment_id, finance_payment_id, amount_minor, currency,
      recorded_by, idempotency_key, recorded_at
    ) VALUES (
      ${envelope.device.tenantId}, ${operation.payload.assignmentId}::uuid, ${payment.id},
      ${outstanding}, ${assignment.currency}, ${envelope.device.collectorUserId},
      ${operation.operationId}, ${serverTime.toISOString()}::timestamptz
    ) RETURNING id
  `);
  if (!evidence) throw new Error('Unable to preserve collection evidence.');
  return {
    paymentId: payment.id,
    allocationId: allocation.id,
    evidenceId: evidence.id,
    receiptNumber,
    amountMinor: outstanding,
    currency: assignment.currency,
    canonicalServerTime: serverTime.toISOString(),
    clientRecordedAt: operation.payload.clientRecordedAt,
  };
}

async function submitReconciliation(
  transaction: Transaction,
  envelope: CollectSyncEnvelope,
  operation: Extract<CollectSyncOperation, { type: 'reconciliation.submit' }>,
  serverTime: Date,
) {
  const [derived] = await transaction.execute<{ readonly expected_minor: string }>(sql`
    SELECT coalesce(sum(evidence.amount_minor), 0)::text AS expected_minor
    FROM operations_collector_collection_evidence evidence
    JOIN operations_collector_assignments assignment ON assignment.tenant_id = evidence.tenant_id
      AND assignment.id = evidence.assignment_id
    WHERE assignment.tenant_id = ${envelope.device.tenantId}
      AND assignment.collector_user_id = ${envelope.device.collectorUserId}::uuid
      AND assignment.route_id = ${operation.payload.routeId}::uuid
      AND evidence.currency = ${operation.payload.currency}
      AND evidence.recorded_at >= ${operation.payload.businessDate}::date
      AND evidence.recorded_at < ${operation.payload.businessDate}::date + interval '1 day'
  `);
  const expected = safeCollectInteger(derived?.expected_minor ?? '0');
  const difference = operation.payload.declaredAmountMinor - expected;
  const status = difference === 0 ? 'accepted' : 'pending_approval';
  const [row] = await transaction.execute<{ readonly id: string }>(sql`
    INSERT INTO collect_reconciliation_submissions (
      tenant_id, device_id, collector_user_id, route_id, business_date, currency,
      server_expected_minor, declared_minor, status, operation_id, submitted_at
    ) VALUES (
      ${envelope.device.tenantId}, ${envelope.device.deviceId}::uuid,
      ${envelope.device.collectorUserId}::uuid, ${operation.payload.routeId}::uuid,
      ${operation.payload.businessDate}::date, ${operation.payload.currency}, ${expected},
      ${operation.payload.declaredAmountMinor}, ${status}, ${operation.operationId}::uuid,
      ${serverTime.toISOString()}::timestamptz
    ) RETURNING id
  `);
  if (!row) throw new Error('Unable to persist reconciliation evidence.');
  await appendCollectAudit(transaction, {
    tenantId: envelope.device.tenantId,
    action: 'tenant.collect.reconciliation.submit',
    resourceType: 'collect_reconciliation',
    resourceId: row.id,
    result: {
      expectedAmountMinor: expected,
      declaredAmountMinor: operation.payload.declaredAmountMinor,
      differenceAmountMinor: difference,
      currency: operation.payload.currency,
      status,
    },
  });
  return {
    reconciliationId: row.id,
    expectedAmountMinor: expected,
    declaredAmountMinor: operation.payload.declaredAmountMinor,
    differenceAmountMinor: difference,
    currency: operation.payload.currency,
    status,
    canonicalServerTime: serverTime.toISOString(),
  };
}

async function auditReceiptPrint(
  transaction: Transaction,
  envelope: CollectSyncEnvelope,
  operation: Extract<CollectSyncOperation, { type: 'receipt.print.audit' }>,
  serverTime: Date,
) {
  const [event] = await transaction.execute<{ readonly id: string }>(sql`
    INSERT INTO collect_receipt_print_events (
      tenant_id, device_id, collector_user_id, assignment_id, finance_payment_id,
      printer_reference, copy_kind, operation_id, printed_at
    )
    SELECT ${envelope.device.tenantId}, ${envelope.device.deviceId}::uuid,
      ${envelope.device.collectorUserId}::uuid, evidence.assignment_id, evidence.finance_payment_id,
      ${operation.payload.printerReference}, ${operation.payload.copyKind},
      ${operation.operationId}::uuid, ${serverTime.toISOString()}::timestamptz
    FROM operations_collector_collection_evidence evidence
    JOIN operations_collector_assignments assignment ON assignment.tenant_id = evidence.tenant_id
      AND assignment.id = evidence.assignment_id
    WHERE evidence.tenant_id = ${envelope.device.tenantId}
      AND evidence.assignment_id = ${operation.payload.assignmentId}::uuid
      AND evidence.finance_payment_id = ${operation.payload.paymentId}::uuid
      AND assignment.collector_user_id = ${envelope.device.collectorUserId}::uuid
    RETURNING id
  `);
  if (!event)
    throw new CollectConflictError('Receipt evidence does not belong to this device collector.');
  await appendCollectAudit(transaction, {
    tenantId: envelope.device.tenantId,
    action: 'tenant.collect.receipt.print.audit',
    resourceType: 'collect_receipt_print',
    resourceId: event.id,
    result: {
      copyKind: operation.payload.copyKind,
      printerReference: operation.payload.printerReference,
      paymentId: operation.payload.paymentId,
    },
  });
  return {
    printEventId: event.id,
    paymentId: operation.payload.paymentId,
    copyKind: operation.payload.copyKind,
    canonicalServerTime: serverTime.toISOString(),
  };
}

async function assertDevice(
  transaction: Transaction,
  device: CollectDeviceIdentity,
  lock = false,
): Promise<void> {
  const lockClause = lock ? sql`FOR SHARE` : sql``;
  const [current] = await transaction.execute<{ readonly valid: boolean }>(sql`
    SELECT true AS valid FROM collect_devices d
    JOIN tenant_memberships membership ON membership.tenant_id = d.tenant_id
      AND membership.user_id = d.collector_user_id AND membership.active
      AND membership.role_key = 'collector'
      AND membership.permissions @> ARRAY['tenant.collection.view','tenant.payment.post']::text[]
    JOIN users identity ON identity.id = d.collector_user_id AND identity.disabled_at IS NULL
    JOIN sessions source_session ON source_session.id = d.source_session_id
      AND source_session.user_id = d.collector_user_id AND source_session.revoked_at IS NULL
      AND source_session.expires_at > clock_timestamp()
    WHERE d.id = ${device.deviceId}::uuid AND d.tenant_id = ${device.tenantId}
      AND d.collector_user_id = ${device.collectorUserId}::uuid
      AND d.status = 'active' AND d.access_expires_at > clock_timestamp()
    ${lockClause}
  `);
  if (!current)
    throw new CollectAuthorizationError(
      'The device, source session, or collector membership is revoked.',
    );
}

async function currentAssignments(
  transaction: Transaction,
  device: CollectDeviceIdentity,
  assignmentIds?: readonly string[],
): Promise<CollectAssignment[]> {
  const rows = await transaction.execute<{
    readonly assignment_id: string;
    readonly subscriber_id: string;
    readonly subscriber_number: string;
    readonly display_name: string;
    readonly address_line: string;
    readonly route_id: string;
    readonly route_reference: string;
    readonly finance_invoice_id: string;
    readonly document_number: string;
    readonly due_on: Date | string;
    readonly outstanding_minor: string;
    readonly currency: 'USD' | 'LBP';
    readonly status: CollectAssignment['status'];
  }>(sql`
    SELECT assignment.id AS assignment_id, assignment.subscriber_id, subscriber.subscriber_number,
      subscriber.display_name, location.address_line, assignment.route_id, assignment.route_reference,
      assignment.finance_invoice_id, invoice.document_number, assignment.due_on,
      greatest(invoice.amount_minor - guard.allocated_minor, 0)::text AS outstanding_minor,
      assignment.currency, assignment.status
    FROM operations_collector_assignments assignment
    JOIN operations_subscribers subscriber ON subscriber.tenant_id = assignment.tenant_id
      AND subscriber.id = assignment.subscriber_id
    JOIN operations_locations location ON location.tenant_id = subscriber.tenant_id
      AND location.id = subscriber.primary_location_id
    JOIN finance_invoices invoice ON invoice.tenant_id = assignment.tenant_id
      AND invoice.id = assignment.finance_invoice_id AND invoice.entry_kind = 'posted'
    JOIN finance_document_guards guard ON guard.tenant_id = invoice.tenant_id
      AND guard.document_type = 'invoice' AND guard.document_id = invoice.id AND guard.reversed_at IS NULL
    WHERE assignment.tenant_id = ${device.tenantId}
      AND assignment.collector_user_id = ${device.collectorUserId}::uuid
      AND assignment.status IN ('assigned','visited','returned')
      AND invoice.amount_minor > guard.allocated_minor
      ${
        assignmentIds
          ? sql`AND assignment.id IN (${sql.join(
              assignmentIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`
          : sql``
      }
    ORDER BY assignment.due_on, assignment.route_reference, assignment.id
  `);
  return rows.map((row) => ({
    assignmentId: row.assignment_id,
    subscriberId: row.subscriber_id,
    subscriberNumber: row.subscriber_number,
    subscriberDisplayName: row.display_name,
    addressLine: row.address_line,
    routeId: row.route_id,
    routeReference: row.route_reference,
    invoiceId: row.finance_invoice_id,
    invoiceNumber: row.document_number,
    dueOn: new Date(row.due_on).toISOString().slice(0, 10),
    outstandingAmountMinor: safeCollectInteger(row.outstanding_minor),
    currency: row.currency,
    status: row.status,
  }));
}

async function installFinanceAuditContext(transaction: Transaction): Promise<void> {
  const [context] = await transaction.execute<{
    readonly actor_id: string;
    readonly session_id: string;
    readonly request_id: string;
    readonly ip_address: string;
    readonly user_agent: string | null;
    readonly reason: string;
  }>(
    sql`SELECT actor_id, session_id, request_id, ip_address, user_agent, reason FROM operations_current_context()`,
  );
  if (!context) throw new CollectAuthorizationError();
  const settings: readonly [string, string][] = [
    ['app.finance_actor_id', context.actor_id],
    ['app.finance_session_id', context.session_id],
    ['app.finance_support_grant_id', ''],
    ['app.finance_action', 'tenant.payment.post'],
    ['app.finance_request_id', context.request_id],
    ['app.finance_ip_address', context.ip_address],
    ['app.finance_user_agent', context.user_agent ?? ''],
    ['app.finance_permission', 'tenant.payment.post'],
    ['app.finance_reason', context.reason],
  ];
  for (const [name, value] of settings)
    await transaction.execute(sql`SELECT set_config(${name}, ${value}, true)`);
}

async function appendCollectAudit(
  transaction: Transaction,
  event: {
    readonly tenantId: VerifiedTenantId;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly result: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  await transaction.execute(sql`
    INSERT INTO collect_audit_outbox (
      tenant_id, action, resource_type, resource_id, actor_id, session_id, permission,
      request_id, idempotency_key, ip_address, user_agent, reason, after_value
    )
    SELECT ${event.tenantId}, ${event.action}, ${event.resourceType}, ${event.resourceId},
      actor_id, session_id, permission, request_id, idempotency_key, ip_address,
      user_agent, reason, ${JSON.stringify(event.result)}::jsonb
    FROM operations_current_context()
  `);
}

function mapDevice(row: {
  readonly id: string;
  readonly tenant_id: string;
  readonly collector_user_id: string;
  readonly source_session_id: string;
  readonly access_expires_at: Date | string;
  readonly scopes: string[];
}): CollectDeviceIdentity {
  return {
    deviceId: row.id,
    tenantId: row.tenant_id as VerifiedTenantId,
    collectorUserId: row.collector_user_id,
    sessionId: row.source_session_id,
    scopes: row.scopes as CollectDeviceIdentity['scopes'],
    accessExpiresAt: new Date(row.access_expires_at).toISOString(),
  };
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}
function array(values: readonly string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

async function collectErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof CollectAuthorizationError ||
      error instanceof CollectConflictError ||
      error instanceof CollectValidationError
    )
      throw error;
    let current: unknown = error;
    for (let depth = 0; depth < 5; depth += 1) {
      if (!current || typeof current !== 'object') break;
      const candidate = current as { code?: string; message?: string; cause?: unknown };
      if (['P4032', 'P4033', '42501', 'C4030'].includes(candidate.code ?? ''))
        throw new CollectAuthorizationError(candidate.message);
      if (['P4090', 'P4091', 'P4092', '23505', '40001', 'C4090'].includes(candidate.code ?? ''))
        throw new CollectConflictError(candidate.message);
      if (['P4001', '23514', '23502', '22P02', '22023', 'C4000'].includes(candidate.code ?? ''))
        throw new CollectValidationError(candidate.message ?? 'Collect validation failed.');
      current = candidate.cause;
    }
    throw error;
  }
}
