import {
  customerAccountSchemas,
  type CustomerAccountCommand,
  type CustomerAccountsWorkspace,
  type CustomerAccountEntry,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export function postCustomerAccountEntry(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: CustomerAccountCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
) {
  const { kind, ...body } = input.command;
  const payload = { ...customerAccountSchemas[kind].parse(body), kind };
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [entry] = await transaction.execute<{ id: string; document_number: string }>(sql`
      SELECT id,document_number FROM post_customer_account_entry(${JSON.stringify(payload)}::jsonb)
    `);
    if (!entry) throw new Error('Customer account append returned no record.');

    return { id: entry.id, documentNumber: entry.document_number };
  });
}

export function readCustomerAccounts(
  database: Database,
  tenantId: VerifiedTenantId,
  input: { readonly authorization: SignedOperationsDatabaseContext },
): Promise<CustomerAccountsWorkspace> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [context] = await transaction.execute<{ allowed: boolean }>(sql`
      SELECT permission='tenant.billing.view' AND action='tenant.customer_account.read'
        AND support_grant_id IS NULL AS allowed FROM operations_current_context()
    `);
    if (!context?.allowed)
      throw new OperationsAuthorizationError('Customer account read authority required.');
    const subscribers = await transaction.execute<{ id: string; name: string }>(sql`
      SELECT id,display_name AS name FROM operations_subscribers
      WHERE tenant_id=${tenantId} ORDER BY display_name,id LIMIT 500
    `);
    const invoices = await transaction.execute<{
      id: string;
      subscriber_id: string;
      document_number: string;
      currency: 'USD' | 'LBP';
      outstanding_minor: string;
      credited_minor: string;
      net_remaining: string;
      vat_remaining: string;
      stamp_remaining: string;
    }>(sql`
      SELECT i.id,s.subscriber_id,i.document_number,i.currency,
        (i.amount_minor-g.allocated_minor-g.credited_minor)::text AS outstanding_minor,
        g.credited_minor::text,
        (p.subtotal_minor-g.credited_net_minor)::text AS net_remaining,
        (p.vat_minor-g.credited_vat_minor)::text AS vat_remaining,
        (p.stamp_duty_minor-g.credited_stamp_minor)::text AS stamp_remaining
      FROM operations_invoice_preparations p
      JOIN operations_services s ON s.tenant_id=p.tenant_id AND s.id=p.service_id
      JOIN finance_invoices i ON i.tenant_id=p.tenant_id AND i.id=p.finance_invoice_id
      JOIN operations_finance_balances() g ON g.tenant_id=i.tenant_id AND g.document_type='invoice'
        AND g.document_id=i.id AND g.reversed_at IS NULL
      WHERE p.tenant_id=${tenantId} AND p.posting_status='posted' AND i.entry_kind='posted'
        AND operations_scope_allows_subscriber(p.tenant_id,s.subscriber_id)
        AND customer_account_invoice_scope(p.tenant_id,i.id)
      ORDER BY i.posted_at DESC,i.id LIMIT 500
    `);
    const entries = await transaction.execute<{
      id: string;
      subscriber_id: string;
      kind: CustomerAccountEntry['kind'];
      document_number: string;
      amount_minor: string;
      currency: 'USD' | 'LBP';
      posted_at: Date | string;
      reason_en: string;
      reason_ar: string;
      actor_id: string;
      invoice_id: string | null;
      source_entry_id: string | null;
      reverses_entry_id: string | null;
      reversed: boolean;
      available_minor: string | null;
    }>(sql`
      SELECT e.id,e.subscriber_id,e.kind,e.document_number,e.amount_minor::text,e.currency,
        e.posted_at,e.reason_en,e.reason_ar,e.actor_id,e.invoice_id,e.source_entry_id,e.reverses_entry_id,
        EXISTS(SELECT 1 FROM operations_customer_account_entries r WHERE r.reverses_entry_id=e.id) AS reversed,
        CASE WHEN e.kind='deposit_received' THEN
          CASE WHEN g.reversed_at IS NOT NULL THEN 0 ELSE e.amount_minor-g.allocated_minor END
          END::text AS available_minor
      FROM operations_customer_account_entries e
      LEFT JOIN operations_finance_balances() g ON g.tenant_id=e.tenant_id
        AND g.document_type='payment' AND g.document_id=e.payment_id
      WHERE e.tenant_id=${tenantId} ORDER BY e.posted_at DESC,e.id LIMIT 500
    `);
    return {
      subscribers: [...subscribers],
      invoices: invoices.map((i) => ({
        id: i.id,
        subscriberId: i.subscriber_id,
        documentNumber: i.document_number,
        currency: i.currency,
        outstandingMinor: minor(i.outstanding_minor),
        creditedMinor: minor(i.credited_minor),
        netRemainingMinor: minor(i.net_remaining),
        vatRemainingMinor: minor(i.vat_remaining),
        stampRemainingMinor: minor(i.stamp_remaining),
      })),
      entries: entries.map((e) => ({
        id: e.id,
        subscriberId: e.subscriber_id,
        kind: e.kind,
        documentNumber: e.document_number,
        amountMinor: minor(e.amount_minor),
        currency: e.currency,
        postedAt: new Date(e.posted_at).toISOString(),
        reasonEn: e.reason_en,
        reasonAr: e.reason_ar,
        actorId: e.actor_id,
        invoiceId: e.invoice_id,
        sourceEntryId: e.source_entry_id,
        reversesEntryId: e.reverses_entry_id,
        reversed: e.reversed,
        availableMinor: e.available_minor === null ? null : minor(e.available_minor),
      })),
    };
  });
}
function minor(value: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error('Unsafe customer account amount.');
  return amount;
}
