import {
  voucherBatchInputSchema,
  voucherRedeemInputSchema,
  type DealerRecord,
  type VoucherBatchInput,
  type VoucherRedeemInput,
  type VerifiedTenantId,
} from '@isp/contracts';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export async function readDealers(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly DealerRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      dealer_code: string;
      dealer_name: string;
      contact_phone: string;
      credit_limit_minor_usd: string;
      credit_limit_minor_lbp: string;
      commission_rate_bps: number;
      active: boolean;
    }>(sql`
      SELECT id, dealer_code, dealer_name, contact_phone, credit_limit_minor_usd::text,
             credit_limit_minor_lbp::text, commission_rate_bps, active
      FROM operations_dealers
      WHERE tenant_id = ${tenantId}
      ORDER BY dealer_name ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      dealerCode: r.dealer_code,
      dealerName: r.dealer_name,
      contactPhone: r.contact_phone,
      creditLimitMinorUsd: parseInt(r.credit_limit_minor_usd, 10),
      creditLimitMinorLbp: parseInt(r.credit_limit_minor_lbp, 10),
      commissionRateBps: r.commission_rate_bps,
      active: r.active,
    }));
  });
}

export async function generateVoucherBatch(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: VoucherBatchInput;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly batchId: string; readonly count: number }> {
  const validated = voucherBatchInputSchema.parse(input.command);

  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [batch] = await transaction.execute<{ id: string }>(sql`
      INSERT INTO operations_voucher_batches (
        tenant_id, batch_number, dealer_id, face_value_minor, currency, quantity
      ) VALUES (
        ${tenantId}, ${validated.batchNumber}, ${validated.dealerId ?? null},
        ${validated.faceValueMinor}, ${validated.currency}, ${validated.quantity}
      )
      RETURNING id
    `);

    if (!batch) {
      throw new Error('Failed to create voucher batch.');
    }

    for (let i = 1; i <= validated.quantity; i++) {
      const serialNumber = `${validated.batchNumber}-${i.toString().padStart(5, '0')}`;
      const pinRaw = Math.floor(100000000000 + Math.random() * 900000000000).toString();
      const pinHash = createHash('sha256').update(pinRaw).digest('hex');

      await transaction.execute(sql`
        INSERT INTO operations_vouchers (
          tenant_id, batch_id, serial_number, pin_hash, status
        ) VALUES (
          ${tenantId}, ${batch.id}, ${serialNumber}, ${pinHash}, 'created'
        )
      `);
    }

    return { batchId: batch.id, count: validated.quantity };
  });
}

export async function redeemVoucher(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: VoucherRedeemInput;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly voucherId: string; readonly status: string }> {
  const validated = voucherRedeemInputSchema.parse(input.command);
  const pinHash = createHash('sha256').update(validated.pinCode).digest('hex');

  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [voucher] = await transaction.execute<{ id: string; status: string }>(sql`
      SELECT id, status FROM operations_vouchers
      WHERE tenant_id = ${tenantId} AND serial_number = ${validated.serialNumber} AND pin_hash = ${pinHash}
    `);

    if (!voucher) {
      throw new OperationsAuthorizationError('Invalid voucher serial or PIN code.');
    }

    if (voucher.status !== 'created' && voucher.status !== 'issued') {
      throw new Error(`Voucher is already ${voucher.status}.`);
    }

    await transaction.execute(sql`
      UPDATE operations_vouchers
      SET status = 'redeemed', redeemed_by_subscriber_id = ${validated.subscriberId}, redeemed_at = clock_timestamp()
      WHERE id = ${voucher.id}
    `);

    return { voucherId: voucher.id, status: 'redeemed' };
  });
}
