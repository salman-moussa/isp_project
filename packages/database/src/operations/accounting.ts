import {
  journalEntryInputSchema,
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
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export async function readChartOfAccounts(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly ChartOfAccountRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    // Seed default accounts if empty
    await transaction.execute(sql`
      SELECT seed_tenant_default_chart_of_accounts(${tenantId})
    `);

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
    const [actor] = await transaction.execute<{ actor_id: string }>(sql`
      SELECT actor_id FROM operations_current_context()
    `);

    if (!actor?.actor_id) {
      throw new OperationsAuthorizationError('Valid actor session context required.');
    }

    const [entry] = await transaction.execute<{ id: string }>(sql`
      INSERT INTO operations_journal_entries (
        tenant_id, entry_number, entry_date, description_en, description_ar,
        source_type, source_id, status, posted_by
      ) VALUES (
        ${tenantId}, ${validated.entryNumber}, ${validated.entryDate}::date,
        ${validated.descriptionEn}, ${validated.descriptionAr},
        ${validated.sourceType}, ${validated.sourceId ?? null}, 'posted', ${actor.actor_id}
      )
      RETURNING id
    `);

    if (!entry) {
      throw new Error('Failed to insert journal entry.');
    }

    for (const line of validated.lines) {
      await transaction.execute(sql`
        INSERT INTO operations_journal_lines (
          journal_entry_id, tenant_id, account_id, debit_minor, credit_minor, currency, memo_en, memo_ar
        ) VALUES (
          ${entry.id}, ${tenantId}, ${line.accountId}, ${line.debitMinor}, ${line.creditMinor},
          ${line.currency}, ${line.memoEn ?? null}, ${line.memoAr ?? null}
        )
      `);
    }

    return { id: entry.id, entryNumber: validated.entryNumber };
  });
}

export async function readJournalEntries(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly JournalEntryRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
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
    }>(sql`
      SELECT id, entry_number, entry_date::text, description_en, description_ar,
             source_type, source_id, status, posted_at, posted_by
      FROM operations_journal_entries
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
        JOIN operations_chart_of_accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = ${e.id}
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
        lines: lines.map((l) => ({
          id: l.id,
          accountId: l.account_id,
          accountCode: l.account_code,
          accountNameEn: l.account_name_en,
          accountNameAr: l.account_name_ar,
          debitMinor: parseInt(l.debit_minor, 10),
          creditMinor: parseInt(l.credit_minor, 10),
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

  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const [sub] = await transaction.execute<{ display_name: string }>(sql`
      SELECT display_name FROM operations_subscribers
      WHERE tenant_id = ${tenantId} AND id = ${params.subscriberId}
    `);

    if (!sub) {
      throw new Error(`Subscriber ${params.subscriberId} not found.`);
    }

    const currency = params.currency ?? 'USD';
    const offset = (params.page - 1) * params.pageSize;

    // Fetch entries
    const dbEntries = await transaction.execute<{
      id: string;
      posted_at: Date | string;
      kind: string;
      document_number: string;
      amount_minor: string;
      reason_en: string;
      reason_ar: string;
    }>(sql`
      SELECT id, posted_at, kind, document_number, amount_minor::text, reason_en, reason_ar
      FROM operations_customer_account_entries
      WHERE tenant_id = ${tenantId} AND subscriber_id = ${params.subscriberId} AND currency = ${currency}
      ORDER BY posted_at ASC, id ASC
    `);

    let runningBalance = 0;
    let totalDebits = 0;
    let totalCredits = 0;

    const allFormattedEntries = dbEntries.map((e) => {
      const amt = parseInt(e.amount_minor, 10);
      let debit = 0;
      let credit = 0;
      let entryType: 'invoice' | 'payment' | 'credit_note' | 'deposit' | 'reversal' = 'deposit';

      if (e.kind.includes('credit_note') || e.kind.includes('reversal')) {
        credit = amt;
        entryType = 'credit_note';
      } else if (e.kind.includes('deposit')) {
        credit = amt;
        entryType = 'deposit';
      } else {
        debit = amt;
        entryType = 'invoice';
      }

      totalDebits += debit;
      totalCredits += credit;
      runningBalance += debit - credit;

      return {
        id: e.id,
        date: typeof e.posted_at === 'string' ? e.posted_at : e.posted_at.toISOString(),
        type: entryType,
        documentNumber: e.document_number,
        descriptionEn: e.reason_en,
        descriptionAr: e.reason_ar,
        debitMinor: debit,
        creditMinor: credit,
        runningBalanceMinor: runningBalance,
        currency,
      };
    });

    const paginated = allFormattedEntries.slice(offset, offset + params.pageSize);

    const startDate = params.startDate ?? '2026-01-01';
    const endDate = params.endDate ?? (new Date().toISOString().split('T')[0] as string);

    return {
      subscriberId: params.subscriberId,
      subscriberName: sub.display_name,
      currency,
      startDate,
      endDate,
      openingBalanceMinor: 0,
      closingBalanceMinor: runningBalance,
      totalDebitsMinor: totalDebits,
      totalCreditsMinor: totalCredits,
      entries: paginated,
      totalCount: allFormattedEntries.length,
      page: params.page,
      pageSize: params.pageSize,
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
    // Seed default COA first
    await transaction.execute(sql`
      SELECT seed_tenant_default_chart_of_accounts(${tenantId})
    `);

    const date: string = asOfDate ?? (new Date().toISOString().split('T')[0] as string);

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
             COALESCE(SUM(CASE WHEN l.currency = 'USD' THEN l.debit_minor ELSE 0 END), 0)::text AS debit_usd,
             COALESCE(SUM(CASE WHEN l.currency = 'USD' THEN l.credit_minor ELSE 0 END), 0)::text AS credit_usd,
             COALESCE(SUM(CASE WHEN l.currency = 'LBP' THEN l.debit_minor ELSE 0 END), 0)::text AS debit_lbp,
             COALESCE(SUM(CASE WHEN l.currency = 'LBP' THEN l.credit_minor ELSE 0 END), 0)::text AS credit_lbp
      FROM operations_chart_of_accounts a
      LEFT JOIN operations_journal_lines l ON l.account_id = a.id
      LEFT JOIN operations_journal_entries e ON e.id = l.journal_entry_id AND e.status = 'posted' AND e.entry_date <= ${date}::date
      WHERE a.tenant_id = ${tenantId}
      GROUP BY a.id, a.account_code, a.account_name_en, a.account_name_ar, a.account_type
      ORDER BY a.account_code ASC
    `);

    let totalDebitUsd = 0;
    let totalCreditUsd = 0;
    let totalDebitLbp = 0;
    let totalCreditLbp = 0;

    const accounts = rows.map((r) => {
      const dUsd = parseInt(r.debit_usd, 10);
      const cUsd = parseInt(r.credit_usd, 10);
      const dLbp = parseInt(r.debit_lbp, 10);
      const cLbp = parseInt(r.credit_lbp, 10);

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

    return {
      asOfDate: date,
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
      closedAt: r.closed_at ? (typeof r.closed_at === 'string' ? r.closed_at : r.closed_at.toISOString()) : null,
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
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [actor] = await transaction.execute<{ actor_id: string }>(sql`
      SELECT actor_id FROM operations_current_context()
    `);

    if (!actor?.actor_id) {
      throw new OperationsAuthorizationError('Valid actor session context required.');
    }

    const status = input.request.closeType === 'hard' ? 'hard_closed' : 'soft_closed';

    const [period] = await transaction.execute<{ id: string }>(sql`
      INSERT INTO operations_accounting_periods (
        tenant_id, period_name, start_date, end_date, status, closed_at, closed_by
      ) VALUES (
        ${tenantId}, ${input.request.periodName}, ${input.request.startDate}::date,
        ${input.request.endDate}::date, ${status}, clock_timestamp(), ${actor.actor_id}
      )
      ON CONFLICT (tenant_id, period_name) DO UPDATE SET
        status = EXCLUDED.status,
        closed_at = clock_timestamp(),
        closed_by = EXCLUDED.closed_by
      RETURNING id
    `);

    if (!period) {
      throw new Error('Failed to update period.');
    }

    return { id: period.id, status };
  });
}
