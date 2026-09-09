import {
  adjustDealerBalanceSchema,
  dealerChannelCommandSchema,
  type AdjustDealerBalanceCommand,
  type DealerChannelCommand,
  type DealerLedgerEntry,
  type DealerRecord,
  type DealerWorkspace,
  type GeneratedVoucherPins,
  type VerifiedTenantId,
  type VoucherBatchRecord,
  type VoucherRedemptionRecord,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  inOperationsTransaction,
  OperationsAuthorizationError,
  OperationsValidationError,
} from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

type CommandResult = Record<string, unknown>;

async function runDealerCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  payload: Record<string, unknown>,
): Promise<CommandResult> {
  return inOperationsTransaction(database, tenantId, authorization, async (tx) => {
    const [row] = await tx.execute<{ result: CommandResult }>(
      sql`SELECT execute_dealer_command(${JSON.stringify(payload)}::jsonb) AS result`,
    );
    if (!row) throw new Error('Dealer command returned no result.');
    return row.result;
  });
}

/** Dealer registry, float ledger and voucher batch commands. */
export async function executeDealerChannelCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: DealerChannelCommand;
  },
): Promise<CommandResult> {
  const command = dealerChannelCommandSchema.parse(input.command);
  return runDealerCommand(database, tenantId, input.authorization, command);
}

/** Batch generation returns the PIN list exactly once; a replay carries no PINs. */
export async function generateVoucherBatch(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: Extract<DealerChannelCommand, { action: 'generate_batch' }>;
  },
): Promise<GeneratedVoucherPins & CommandResult> {
  const result = await executeDealerChannelCommand(database, tenantId, input);
  const pins = Array.isArray(result.pins)
    ? (result.pins as { serialNumber: string; pin: string }[])
    : [];
  return {
    ...result,
    batchId: String(result.batchId),
    batchNumber: String(result.batchNumber),
    pins,
  };
}

/** Approved float correction; the caller must carry the reconciliation permission. */
export async function adjustDealerBalance(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: AdjustDealerBalanceCommand;
  },
): Promise<CommandResult> {
  const command = adjustDealerBalanceSchema.parse(input.command);
  return runDealerCommand(database, tenantId, input.authorization, command);
}

export interface VoucherRedemptionOutcome {
  readonly status: 'redeemed';
  readonly redemptionId: string;
  readonly voucherId: string;
  readonly serialNumber: string;
  readonly subscriberId: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly creditStatus: 'credit_pending' | 'credited';
  readonly replayed?: boolean;
}

/**
 * Marks a voucher redeemed for a subscriber. A wrong PIN is committed as an attempt (locking the
 * voucher on the fifth) and then surfaced as a validation error, so retries cannot brute-force it.
 */
export async function redeemVoucherForSubscriber(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: {
      readonly serialNumber: string;
      readonly pin: string;
      readonly subscriberId: string;
      readonly reasonEn: string;
      readonly reasonAr: string;
    };
  },
): Promise<VoucherRedemptionOutcome> {
  const result = await runDealerCommand(database, tenantId, input.authorization, {
    action: 'redeem_voucher',
    serialNumber: input.command.serialNumber.trim().toUpperCase(),
    pin: input.command.pin,
    subscriberId: input.command.subscriberId,
    reasonEn: input.command.reasonEn,
    reasonAr: input.command.reasonAr,
  });
  if (result.status === 'rejected') {
    throw new OperationsValidationError(
      result.locked
        ? 'The voucher is locked after repeated wrong PINs.'
        : `Wrong PIN. ${String(result.attemptsLeft)} attempt(s) left before the voucher locks.`,
    );
  }
  return result as unknown as VoucherRedemptionOutcome;
}

/** Links the posted subscriber deposit to the redemption; idempotent once credited. */
export async function confirmVoucherCredit(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly command: {
      readonly redemptionId: string;
      readonly accountEntryId: string;
      readonly reasonEn: string;
      readonly reasonAr: string;
    };
  },
): Promise<CommandResult> {
  return runDealerCommand(database, tenantId, input.authorization, {
    action: 'confirm_voucher_credit',
    ...input.command,
  });
}

/** The redemption a credit retry needs to post the subscriber deposit. */
export async function readPendingVoucherRedemption(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly redemptionId: string;
  },
): Promise<{
  readonly id: string;
  readonly serialNumber: string;
  readonly subscriberId: string;
  readonly amountMinor: number;
  readonly currency: 'USD' | 'LBP';
  readonly status: 'credit_pending' | 'credited';
  readonly accountEntryId: string | null;
}> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [row] = await tx.execute<{
      id: string;
      serial_number: string;
      subscriber_id: string;
      amount_minor: string;
      currency: 'USD' | 'LBP';
      status: 'credit_pending' | 'credited';
      account_entry_id: string | null;
    }>(sql`SELECT r.id, v.serial_number, r.subscriber_id, r.amount_minor::text AS amount_minor, r.currency, r.status, r.account_entry_id
           FROM operations_voucher_redemptions r JOIN operations_vouchers v ON v.tenant_id=r.tenant_id AND v.id=r.voucher_id
           WHERE r.tenant_id=${tenantId} AND r.id=${input.redemptionId}`);
    if (!row) throw new OperationsAuthorizationError('Redemption not found in scope.');
    return {
      id: row.id,
      serialNumber: row.serial_number,
      subscriberId: row.subscriber_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      status: row.status,
      accountEntryId: row.account_entry_id,
    };
  });
}

const timestamp = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.toISOString();

export async function readDealerWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<DealerWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{ valid: boolean }>(sql`SELECT true AS valid
      FROM operations_current_context()
      WHERE tenant_id=${tenantId} AND action='tenant.dealer.workspace.read' AND support_grant_id IS NULL
        AND permission IN ('tenant.payment.view','tenant.payment.post','tenant.collection.reconcile')`);
    if (!authority) throw new OperationsAuthorizationError('Payment view authority required.');
    const dealers = await tx.execute<{
      id: string;
      dealer_code: string;
      dealer_name: string;
      dealer_type: DealerRecord['dealerType'];
      contact_name: string | null;
      contact_phone: string;
      email: string | null;
      branch_id: string | null;
      branch_name: string | null;
      credit_limit_minor_usd: string;
      credit_limit_minor_lbp: string;
      commission_rate_bps: number;
      status: DealerRecord['status'];
      notes: string | null;
      version: number;
      balance_usd: string;
      balance_lbp: string;
      issued_batches: string;
      redeemed_vouchers: string;
    }>(sql`SELECT d.id, d.dealer_code, d.dealer_name, d.dealer_type, d.contact_name, d.contact_phone, d.email,
        d.branch_id, b.name_en AS branch_name, d.credit_limit_minor_usd::text, d.credit_limit_minor_lbp::text,
        d.commission_rate_bps, d.status, d.notes, d.version,
        dealer_balance_minor(d.tenant_id, d.id, 'USD')::text AS balance_usd,
        dealer_balance_minor(d.tenant_id, d.id, 'LBP')::text AS balance_lbp,
        (SELECT count(*) FROM operations_voucher_batches vb WHERE vb.tenant_id=d.tenant_id AND vb.dealer_id=d.id AND vb.status='issued')::text AS issued_batches,
        (SELECT count(*) FROM operations_vouchers v JOIN operations_voucher_batches vb ON vb.tenant_id=v.tenant_id AND vb.id=v.batch_id
           WHERE vb.tenant_id=d.tenant_id AND vb.dealer_id=d.id AND v.status='redeemed')::text AS redeemed_vouchers
      FROM operations_dealers d LEFT JOIN operations_branches b ON b.tenant_id=d.tenant_id AND b.id=d.branch_id
      WHERE d.tenant_id=${tenantId} ORDER BY d.status, d.dealer_name, d.id LIMIT 500`);
    const batches = await tx.execute<{
      id: string;
      batch_number: string;
      status: VoucherBatchRecord['status'];
      dealer_id: string | null;
      dealer_name: string | null;
      face_value_minor: string;
      currency: 'USD' | 'LBP';
      quantity: number;
      issued_count: string;
      redeemed_count: string;
      cancelled_count: string;
      generated_at: Date | string;
      issued_at: Date | string | null;
      expires_at: Date | string | null;
      version: number;
    }>(sql`SELECT vb.id, vb.batch_number, vb.status, vb.dealer_id, d.dealer_name, vb.face_value_minor::text, vb.currency,
        vb.quantity, vb.generated_at, vb.issued_at, vb.expires_at, vb.version,
        (SELECT count(*) FROM operations_vouchers v WHERE v.tenant_id=vb.tenant_id AND v.batch_id=vb.id AND v.status='issued')::text AS issued_count,
        (SELECT count(*) FROM operations_vouchers v WHERE v.tenant_id=vb.tenant_id AND v.batch_id=vb.id AND v.status='redeemed')::text AS redeemed_count,
        (SELECT count(*) FROM operations_vouchers v WHERE v.tenant_id=vb.tenant_id AND v.batch_id=vb.id AND v.status='cancelled')::text AS cancelled_count
      FROM operations_voucher_batches vb LEFT JOIN operations_dealers d ON d.tenant_id=vb.tenant_id AND d.id=vb.dealer_id
      WHERE vb.tenant_id=${tenantId} ORDER BY vb.generated_at DESC, vb.id LIMIT 300`);
    const ledger = await tx.execute<{
      id: string;
      dealer_id: string;
      dealer_name: string;
      entry_kind: DealerLedgerEntry['entryKind'];
      currency: 'USD' | 'LBP';
      amount_minor: string;
      balance_after_minor: string;
      batch_number: string | null;
      reference: string | null;
      reason_en: string;
      reason_ar: string;
      actor_name: string;
      created_at: Date | string;
    }>(sql`SELECT l.id, l.dealer_id, d.dealer_name, l.entry_kind, l.currency, l.amount_minor::text, l.balance_after_minor::text,
        vb.batch_number, l.reference, l.reason_en, l.reason_ar, coalesce(u.display_name, l.actor_id::text) AS actor_name, l.created_at
      FROM operations_dealer_ledger l JOIN operations_dealers d ON d.tenant_id=l.tenant_id AND d.id=l.dealer_id
      LEFT JOIN operations_voucher_batches vb ON vb.tenant_id=l.tenant_id AND vb.id=l.batch_id
      LEFT JOIN users u ON u.id=l.actor_id
      WHERE l.tenant_id=${tenantId} ORDER BY l.created_at DESC, l.id LIMIT 200`);
    const redemptions = await tx.execute<{
      id: string;
      serial_number: string;
      batch_number: string;
      subscriber_id: string;
      subscriber_name: string;
      amount_minor: string;
      currency: 'USD' | 'LBP';
      status: VoucherRedemptionRecord['status'];
      account_entry_id: string | null;
      redeemed_at: Date | string;
      credited_at: Date | string | null;
      actor_name: string;
    }>(sql`SELECT r.id, v.serial_number, vb.batch_number, r.subscriber_id, s.display_name AS subscriber_name,
        r.amount_minor::text, r.currency, r.status, r.account_entry_id, r.redeemed_at, r.credited_at,
        coalesce(u.display_name, r.actor_id::text) AS actor_name
      FROM operations_voucher_redemptions r
      JOIN operations_vouchers v ON v.tenant_id=r.tenant_id AND v.id=r.voucher_id
      JOIN operations_voucher_batches vb ON vb.tenant_id=r.tenant_id AND vb.id=r.batch_id
      JOIN operations_subscribers s ON s.tenant_id=r.tenant_id AND s.id=r.subscriber_id
      LEFT JOIN users u ON u.id=r.actor_id
      WHERE r.tenant_id=${tenantId}
      ORDER BY CASE r.status WHEN 'credit_pending' THEN 0 ELSE 1 END, r.redeemed_at DESC, r.id LIMIT 200`);
    const branches = await tx.execute<{ id: string; nameEn: string; nameAr: string }>(
      sql`SELECT id, name_en AS "nameEn", name_ar AS "nameAr" FROM operations_branches WHERE tenant_id=${tenantId} ORDER BY name_en, id`,
    );
    const subscribers = await tx.execute<{ id: string; name: string; subscriberNumber: string }>(
      sql`SELECT id, display_name AS name, subscriber_number AS "subscriberNumber" FROM operations_subscribers
          WHERE tenant_id=${tenantId} AND status::text NOT IN ('terminated','closed') ORDER BY display_name, id LIMIT 1001`,
    );
    const [summary] = await tx.execute<{
      active_dealers: string;
      outstanding: string;
      pending: string;
      float_usd: string;
      float_lbp: string;
    }>(sql`SELECT
      (SELECT count(*) FROM operations_dealers d WHERE d.tenant_id=${tenantId} AND d.status='active')::text AS active_dealers,
      (SELECT count(*) FROM operations_vouchers v WHERE v.tenant_id=${tenantId} AND v.status='issued')::text AS outstanding,
      (SELECT count(*) FROM operations_voucher_redemptions r WHERE r.tenant_id=${tenantId} AND r.status='credit_pending')::text AS pending,
      (SELECT coalesce(sum(amount_minor),0) FROM operations_dealer_ledger l WHERE l.tenant_id=${tenantId} AND l.currency='USD')::text AS float_usd,
      (SELECT coalesce(sum(amount_minor),0) FROM operations_dealer_ledger l WHERE l.tenant_id=${tenantId} AND l.currency='LBP')::text AS float_lbp`);
    return {
      dealers: dealers.map((row): DealerRecord => {
        const usd = Number(row.balance_usd);
        const lbp = Number(row.balance_lbp);
        const limitUsd = Number(row.credit_limit_minor_usd);
        const limitLbp = Number(row.credit_limit_minor_lbp);
        return {
          id: row.id,
          dealerCode: row.dealer_code,
          dealerName: row.dealer_name,
          dealerType: row.dealer_type,
          contactName: row.contact_name,
          contactPhone: row.contact_phone,
          email: row.email,
          branchId: row.branch_id,
          branchName: row.branch_name,
          creditLimitMinorUsd: limitUsd,
          creditLimitMinorLbp: limitLbp,
          commissionRateBps: Number(row.commission_rate_bps),
          status: row.status,
          notes: row.notes,
          version: Number(row.version),
          balances: [
            {
              currency: 'USD',
              balanceMinor: usd,
              creditLimitMinor: limitUsd,
              availableMinor: usd + limitUsd,
            },
            {
              currency: 'LBP',
              balanceMinor: lbp,
              creditLimitMinor: limitLbp,
              availableMinor: lbp + limitLbp,
            },
          ],
          issuedBatches: Number(row.issued_batches),
          redeemedVouchers: Number(row.redeemed_vouchers),
        };
      }),
      batches: batches.map(
        (row): VoucherBatchRecord => ({
          id: row.id,
          batchNumber: row.batch_number,
          status: row.status,
          dealerId: row.dealer_id,
          dealerName: row.dealer_name,
          faceValueMinor: Number(row.face_value_minor),
          currency: row.currency,
          quantity: Number(row.quantity),
          issuedCount: Number(row.issued_count),
          redeemedCount: Number(row.redeemed_count),
          cancelledCount: Number(row.cancelled_count),
          generatedAt: timestamp(row.generated_at) ?? '',
          issuedAt: timestamp(row.issued_at),
          expiresAt: timestamp(row.expires_at),
          version: Number(row.version),
        }),
      ),
      ledger: ledger.map(
        (row): DealerLedgerEntry => ({
          id: row.id,
          dealerId: row.dealer_id,
          dealerName: row.dealer_name,
          entryKind: row.entry_kind,
          currency: row.currency,
          amountMinor: Number(row.amount_minor),
          balanceAfterMinor: Number(row.balance_after_minor),
          batchNumber: row.batch_number,
          reference: row.reference,
          reasonEn: row.reason_en,
          reasonAr: row.reason_ar,
          actorName: row.actor_name,
          createdAt: timestamp(row.created_at) ?? '',
        }),
      ),
      redemptions: redemptions.map(
        (row): VoucherRedemptionRecord => ({
          id: row.id,
          serialNumber: row.serial_number,
          batchNumber: row.batch_number,
          subscriberId: row.subscriber_id,
          subscriberName: row.subscriber_name,
          amountMinor: Number(row.amount_minor),
          currency: row.currency,
          status: row.status,
          accountEntryId: row.account_entry_id,
          redeemedAt: timestamp(row.redeemed_at) ?? '',
          creditedAt: timestamp(row.credited_at),
          actorName: row.actor_name,
        }),
      ),
      branches: [...branches],
      subscribers: subscribers.slice(0, 1000),
      subscriberDirectoryTruncated: subscribers.length > 1000,
      summary: {
        activeDealers: Number(summary?.active_dealers ?? 0),
        issuedVouchersOutstanding: Number(summary?.outstanding ?? 0),
        pendingCredits: Number(summary?.pending ?? 0),
        floatUsdMinor: Number(summary?.float_usd ?? 0),
        floatLbpMinor: Number(summary?.float_lbp ?? 0),
      },
    };
  });
}
