import {
  journalEntryInputSchema,
  periodCloseRequestSchema,
  customerStatementQuerySchema,
  type JournalEntryInput,
  type JournalEntryRecord,
  type CustomerStatementQuery,
  type CustomerStatementResponse,
  type TrialBalanceResponse,
  type ChartOfAccountRecord,
  type AccountingPeriodRecord,
  type PeriodCloseRequest,
  type VerifiedTenantId,
} from '@isp/contracts';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

type AccountingTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
async function requireAccountingScope(
  transaction: AccountingTransaction,
  tenantId: VerifiedTenantId,
) {
  const [access] = await transaction.execute<{ allowed: boolean }>(
    sql`SELECT accounting_scope_allows(${tenantId}) AS allowed`,
  );
  if (!access?.allowed)
    throw new OperationsAuthorizationError('Tenant-wide accounting permission is required.');
}

function safeMinor(value: string | number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error('Accounting amount exceeds safe integer range.');
  return number;
}

export async function readChartOfAccounts(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly ChartOfAccountRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    await requireAccountingScope(transaction, tenantId);

    const rows = await transaction.execute<{
      id: string;
      account_code: string;
      account_name_en: string;
      account_name_ar: string;
      account_type: ChartOfAccountRecord['accountType'];
      currency: ChartOfAccountRecord['currency'];
      is_system: boolean;
      active: boolean;
    }>(sql`
      SELECT id, account_code, account_name_en, account_name_ar, account_type, currency, is_system, active
      FROM operations_chart_of_accounts
      WHERE tenant_id = ${tenantId}
      ORDER BY account_code ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      accountCode: r.account_code,
      accountNameEn: r.account_name_en,
      accountNameAr: r.account_name_ar,
      accountType: r.account_type,
      currency: r.currency,
      isSystem: r.is_system,
      active: r.active,
    }));
  });
}

export async function postJournalEntry(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: JournalEntryInput;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly entryNumber: string }> {
  const validated = journalEntryInputSchema.parse(input.command);

  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [entry] = await transaction.execute<{ id: string }>(sql`
      SELECT post_manual_accounting_journal(${JSON.stringify(validated)}::jsonb) AS id
    `);
    if (!entry?.id) throw new Error('Journal was not posted.');
    return { id: entry.id, entryNumber: validated.entryNumber };
  });
}

export async function readJournalEntries(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly JournalEntryRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    await requireAccountingScope(transaction, tenantId);
    const entries = await transaction.execute<{
      id: string;
      entry_number: string;
      entry_date: string;
      description_en: string;
      description_ar: string;
      source_type: string;
      source_id: string | null;
      status: 'posted' | 'reversed';
      posted_at: Date | string;
      posted_by: string;
      classification_required: boolean;
    }>(sql`
      SELECT id, entry_number, entry_date::text, description_en, description_ar,
             source_type, source_id, status, posted_at, posted_by,
             classification_required AND reverses_journal_id IS NULL
               AND NOT EXISTS(SELECT 1 FROM operations_accounting_classifications c
                 WHERE c.tenant_id=j.tenant_id AND c.source_journal_id=j.id)
               AND NOT EXISTS(SELECT 1 FROM operations_journal_entries r
                 WHERE r.tenant_id=j.tenant_id AND r.reverses_journal_id=j.id) AS classification_required
      FROM operations_journal_entries j
      WHERE tenant_id = ${tenantId}
      ORDER BY posted_at DESC, id DESC
      LIMIT 100
    `);

    const result: JournalEntryRecord[] = [];

    for (const e of entries) {
      const lines = await transaction.execute<{
        id: string;
        account_id: string;
        account_code: string;
        account_name_en: string;
        account_name_ar: string;
        debit_minor: string;
        credit_minor: string;
        currency: 'USD' | 'LBP';
        memo_en: string | null;
        memo_ar: string | null;
      }>(sql`
        SELECT l.id, l.account_id, a.account_code, a.account_name_en, a.account_name_ar,
               l.debit_minor::text, l.credit_minor::text, l.currency, l.memo_en, l.memo_ar
        FROM operations_journal_lines l
        JOIN operations_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
        WHERE l.journal_entry_id = ${e.id} AND l.tenant_id = ${tenantId}
      `);

      result.push({
        id: e.id,
        entryNumber: e.entry_number,
        entryDate: e.entry_date,
        descriptionEn: e.description_en,
        descriptionAr: e.description_ar,
        sourceType: e.source_type,
        sourceId: e.source_id,
        status: e.status,
        postedAt: typeof e.posted_at === 'string' ? e.posted_at : e.posted_at.toISOString(),
        postedBy: e.posted_by,
        classificationRequired: e.classification_required,
        lines: lines.map((l) => ({
          id: l.id,
          accountId: l.account_id,
          accountCode: l.account_code,
          accountNameEn: l.account_name_en,
          accountNameAr: l.account_name_ar,
          debitMinor: safeMinor(l.debit_minor),
          creditMinor: safeMinor(l.credit_minor),
          currency: l.currency,
          memoEn: l.memo_en,
          memoAr: l.memo_ar,
        })),
      });
    }

    return result;
  });
}

export async function readCustomerStatement(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  query: CustomerStatementQuery,
): Promise<CustomerStatementResponse> {
  const params = customerStatementQuerySchema.parse(query);
  const startDate = params.startDate ?? '0001-01-01';
  const endDate = params.endDate ?? new Date().toISOString().slice(0, 10);
  if (startDate > endDate) throw new Error('Statement start must not follow end.');
  const currency = params.currency ?? 'USD';
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const [access] = await transaction.execute<{ allowed: boolean }>(sql`
      SELECT EXISTS(SELECT 1 FROM operations_current_context()
        WHERE tenant_id=${tenantId} AND permission='tenant.accounting.view'
          AND action='tenant.accounting.statement.read' AND support_grant_id IS NULL) AS allowed
    `);
    if (!access?.allowed)
      throw new OperationsAuthorizationError('Signed accounting statement permission is required.');
    const [sub] = await transaction.execute<{ display_name: string }>(sql`
      SELECT display_name FROM operations_subscribers WHERE tenant_id=${tenantId}
        AND id=${params.subscriberId} AND operations_scope_allows_subscriber(${tenantId},id)
    `);
    if (!sub) throw new OperationsAuthorizationError('Subscriber is not available in this scope.');
    // One net-customer-balance ledger. Deposit receipts are counted once, not again on allocation.
    // All sources are immutable; linked invoice/allocation/account reversals retain their own date.
    const ledger = sql`
      WITH subscriber_invoices AS (
        SELECT i.id,i.document_number,i.posted_at,i.amount_minor,i.currency
        FROM operations_invoice_preparations p
        JOIN operations_services s ON s.tenant_id=p.tenant_id AND s.id=p.service_id
        JOIN finance_invoices i ON i.tenant_id=p.tenant_id AND i.id=p.finance_invoice_id
        WHERE p.tenant_id=${tenantId} AND s.subscriber_id=${params.subscriberId}
          AND p.posting_status='posted' AND i.entry_kind='posted' AND i.currency=${currency}
      ), ledger AS (
        SELECT id,posted_at,'invoice'::text AS kind,document_number,
          'Invoice posted'::text AS reason_en,'فاتورة مرحلة'::text AS reason_ar,
          amount_minor::numeric AS debit,0::numeric AS credit FROM subscriber_invoices
        UNION ALL
        SELECT r.id,r.posted_at,'reversal',r.document_number,'Invoice reversed','عكس الفاتورة',0,r.amount_minor
          FROM finance_invoices r JOIN subscriber_invoices i ON r.reverses_invoice_id=i.id
          WHERE r.tenant_id=${tenantId} AND r.entry_kind='reversal' AND r.currency=${currency}
        UNION ALL
        SELECT a.id,a.posted_at,CASE a.entry_kind WHEN 'reversal' THEN 'reversal' ELSE 'payment' END,
          p.receipt_number,'Payment allocation / reversal','تخصيص دفعة / عكس تخصيص',
          CASE a.entry_kind WHEN 'reversal' THEN a.amount_minor ELSE 0 END,
          CASE a.entry_kind WHEN 'allocation' THEN a.amount_minor ELSE 0 END
        FROM finance_payment_allocations a
        JOIN subscriber_invoices i ON i.id=a.invoice_id
        JOIN finance_payments p ON p.tenant_id=a.tenant_id AND p.id=a.payment_id
        WHERE a.tenant_id=${tenantId} AND a.currency=${currency}
          AND NOT EXISTS(SELECT 1 FROM operations_customer_account_entries d
            WHERE d.tenant_id=a.tenant_id AND d.payment_id=a.payment_id AND d.kind='deposit_received')
        UNION ALL
        SELECT id,posted_at,
          CASE WHEN kind='credit_note' THEN 'credit_note'
            WHEN kind IN ('deposit_received','deposit_applied') THEN 'deposit' ELSE 'reversal' END,
          document_number,reason_en,reason_ar,
          CASE WHEN kind IN ('credit_reversal','deposit_reversal') THEN amount_minor ELSE 0 END,
          CASE WHEN kind IN ('credit_note','deposit_received') THEN amount_minor ELSE 0 END
        FROM operations_customer_account_entries
        WHERE tenant_id=${tenantId} AND subscriber_id=${params.subscriberId} AND currency=${currency}
      ), bounded AS (
        SELECT *,sum(debit-credit) OVER(ORDER BY posted_at,id ROWS UNBOUNDED PRECEDING) AS running
        FROM ledger WHERE posted_at < ((${endDate}::date+1)::timestamp AT TIME ZONE 'UTC')
      ), period AS (
        SELECT * FROM bounded WHERE posted_at >= (${startDate}::date::timestamp AT TIME ZONE 'UTC')
      ), totals AS (
        SELECT
          coalesce((SELECT sum(debit-credit) FROM bounded
            WHERE posted_at < (${startDate}::date::timestamp AT TIME ZONE 'UTC')),0)::text AS opening,
          coalesce((SELECT sum(debit-credit) FROM bounded),0)::text AS closing,
          coalesce(sum(debit),0)::text AS debits,coalesce(sum(credit),0)::text AS credits,
          count(*)::text AS count FROM period
      ), page AS (
        SELECT * FROM period ORDER BY posted_at,id LIMIT ${params.pageSize}
          OFFSET ${(params.page - 1) * params.pageSize}
      )
      SELECT totals.*,page.id,page.posted_at,page.kind,page.document_number,page.reason_en,page.reason_ar,
        page.debit::text,page.credit::text,page.running::text
      FROM totals LEFT JOIN page ON true ORDER BY page.posted_at,page.id
    `;
    const rows = await transaction.execute<{
      opening: string;
      closing: string;
      debits: string;
      credits: string;
      count: string;
      id: string | null;
      posted_at: Date | string;
      kind: CustomerStatementResponse['entries'][number]['type'];
      document_number: string;
      reason_en: string;
      reason_ar: string;
      debit: string;
      credit: string;
      running: string;
    }>(ledger);
    const totals = rows[0]!;
    return {
      subscriberId: params.subscriberId,
      subscriberName: sub.display_name,
      currency,
      startDate,
      endDate,
      openingBalanceMinor: safeMinor(totals.opening),
      closingBalanceMinor: safeMinor(totals.closing),
      totalDebitsMinor: safeMinor(totals.debits),
      totalCreditsMinor: safeMinor(totals.credits),
      totalCount: safeMinor(totals.count),
      page: params.page,
      pageSize: params.pageSize,
      entries: rows
        .filter((r) => r.id !== null)
        .map((r) => ({
          id: r.id!,
          date: typeof r.posted_at === 'string' ? r.posted_at : r.posted_at.toISOString(),
          type: r.kind,
          documentNumber: r.document_number,
          descriptionEn: r.reason_en,
          descriptionAr: r.reason_ar,
          debitMinor: safeMinor(r.debit),
          creditMinor: safeMinor(r.credit),
          runningBalanceMinor: safeMinor(r.running),
          currency,
        })),
    };
  });
}

export async function readTrialBalance(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
  asOfDate?: string,
): Promise<TrialBalanceResponse> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    await requireAccountingScope(transaction, tenantId);

    const date: string = z.iso.date().parse(asOfDate ?? new Date().toISOString().slice(0, 10));

    const rows = await transaction.execute<{
      account_id: string;
      account_code: string;
      account_name_en: string;
      account_name_ar: string;
      account_type: TrialBalanceResponse['accounts'][0]['accountType'];
      debit_usd: string;
      credit_usd: string;
      debit_lbp: string;
      credit_lbp: string;
    }>(sql`
      SELECT a.id AS account_id, a.account_code, a.account_name_en, a.account_name_ar, a.account_type,
             COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND l.currency = 'USD' THEN l.debit_minor ELSE 0 END), 0)::text AS debit_usd,
             COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND l.currency = 'USD' THEN l.credit_minor ELSE 0 END), 0)::text AS credit_usd,
             COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND l.currency = 'LBP' THEN l.debit_minor ELSE 0 END), 0)::text AS debit_lbp,
             COALESCE(SUM(CASE WHEN e.id IS NOT NULL AND l.currency = 'LBP' THEN l.credit_minor ELSE 0 END), 0)::text AS credit_lbp
      FROM operations_chart_of_accounts a
      LEFT JOIN operations_journal_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
      LEFT JOIN operations_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id AND e.status = 'posted' AND e.entry_date <= ${date}::date
      WHERE a.tenant_id = ${tenantId}
      GROUP BY a.id, a.account_code, a.account_name_en, a.account_name_ar, a.account_type
      ORDER BY a.account_code ASC
    `);

    let totalDebitUsd = 0;
    let totalCreditUsd = 0;
    let totalDebitLbp = 0;
    let totalCreditLbp = 0;

    const accounts = rows.map((r) => {
      const dUsd = safeMinor(r.debit_usd);
      const cUsd = safeMinor(r.credit_usd);
      const dLbp = safeMinor(r.debit_lbp);
      const cLbp = safeMinor(r.credit_lbp);

      totalDebitUsd += dUsd;
      totalCreditUsd += cUsd;
      totalDebitLbp += dLbp;
      totalCreditLbp += cLbp;

      return {
        accountId: r.account_id,
        accountCode: r.account_code,
        accountNameEn: r.account_name_en,
        accountNameAr: r.account_name_ar,
        accountType: r.account_type,
        debitMinorUsd: dUsd,
        creditMinorUsd: cUsd,
        debitMinorLbp: dLbp,
        creditMinorLbp: cLbp,
        netBalanceMinorUsd: dUsd - cUsd,
        netBalanceMinorLbp: dLbp - cLbp,
      };
    });

    [totalDebitUsd, totalCreditUsd, totalDebitLbp, totalCreditLbp].forEach(safeMinor);
    const [coverage] = await transaction.execute<{
      has_legacy: boolean;
      has_unjournaled: boolean;
      has_unjournaled_sources: boolean;
      has_unclassified: boolean;
    }>(sql`
      SELECT EXISTS(SELECT 1 FROM operations_journal_entries WHERE tenant_id=${tenantId}
        AND entry_date<=${date}::date AND posting_version='legacy') AS has_legacy,
        accounting_has_unjournaled_invoices(${tenantId},${date}::date) AS has_unjournaled,
        accounting_has_unjournaled_sources(${tenantId},${date}::date) AS has_unjournaled_sources,
        accounting_has_unclassified_entries(${tenantId},${date}::date) AS has_unclassified
    `);
    return {
      asOfDate: date,
      coverage: {
        hasLegacyEntries: coverage!.has_legacy,
        hasUnjournaledSources: coverage!.has_unjournaled_sources,
        hasUnclassifiedEntries: coverage!.has_unclassified,
        hasUnjournaledInvoices: coverage!.has_unjournaled,
      },
      accounts,
      totalDebitUsd,
      totalCreditUsd,
      totalDebitLbp,
      totalCreditLbp,
    };
  });
}

export async function readAccountingPeriods(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly AccountingPeriodRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    await requireAccountingScope(transaction, tenantId);
    const rows = await transaction.execute<{
      id: string;
      period_name: string;
      start_date: string;
      end_date: string;
      status: AccountingPeriodRecord['status'];
      closed_at: Date | string | null;
      closed_by: string | null;
    }>(sql`
      SELECT id, period_name, start_date::text, end_date::text, status, closed_at, closed_by
      FROM operations_accounting_periods
      WHERE tenant_id = ${tenantId}
      ORDER BY start_date DESC
    `);

    return rows.map((r) => ({
      id: r.id,
      periodName: r.period_name,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      closedAt: r.closed_at
        ? typeof r.closed_at === 'string'
          ? r.closed_at
          : r.closed_at.toISOString()
        : null,
      closedBy: r.closed_by,
    }));
  });
}

export async function closeAccountingPeriod(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly request: PeriodCloseRequest;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string }> {
  const validated = periodCloseRequestSchema.parse(input.request);
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [period] = await transaction.execute<{ id: string }>(sql`
      SELECT close_accounting_period(${JSON.stringify(validated)}::jsonb) AS id
    `);
    if (!period?.id) throw new Error('Period was not closed.');
    return {
      id: period.id,
      status: validated.closeType === 'hard' ? 'hard_closed' : 'soft_closed',
    };
  });
}
