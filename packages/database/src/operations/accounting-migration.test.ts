import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const accountingMigration = resolve(
  import.meta.dirname,
  '../../migrations/202609021300_tenant_accounting_system.sql',
);

describe('accounting system migration', () => {
  it('creates chart of accounts, journal entries, journal lines, and accounting periods with FORCE RLS', async () => {
    const migration = await readFile(accountingMigration, 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS operations_chart_of_accounts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS operations_journal_entries');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS operations_journal_lines');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS operations_accounting_periods');
    expect(migration).toContain(
      'ALTER TABLE operations_chart_of_accounts FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('ALTER TABLE operations_journal_entries FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE operations_journal_lines FORCE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'ALTER TABLE operations_accounting_periods FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('seed_tenant_default_chart_of_accounts');
  });
});
describe('accounting forward integrity', () => {
  it('enforces tenant links, immutable postings, per-currency balance, replay and closed periods', async () => {
    const migration = await readFile(
      resolve(import.meta.dirname, '../../migrations/202609021800_tenant_accounting_integrity.sql'),
      'utf8',
    );
    for (const invariant of [
      'FOREIGN KEY(tenant_id,account_id)',
      'journal_line_one_side',
      'DEFERRABLE INITIALLY DEFERRED',
      'operations_reject_append_only_mutation()',
      'accounting period is closed',
      'request_payload IS DISTINCT FROM payload',
      'credit_minor,debit_minor,currency',
      'NEW.net_minor',
      'NEW.vat_minor',
      'NEW.stamp_minor',
      'journal_customer_once',
      'REVOKE INSERT,UPDATE,DELETE,TRUNCATE',
      'period close blocked: invoice/legacy accounting coverage needs reconciliation',
    ]) {
      expect(migration).toContain(invariant);
    }
    const owner = await readFile(
      resolve(
        import.meta.dirname,
        '../../migrations/202609021801_tenant_accounting_owner_scope.sql',
      ),
      'utf8',
    );
    for (const table of [
      'operations_chart_of_accounts',
      'operations_journal_entries',
      'operations_journal_lines',
      'operations_accounting_periods',
    ]) {
      expect(owner).toContain('c.tenant_id=' + table + '.tenant_id');
    }
    expect(owner).not.toContain('TO orvex_runtime');
  });
});
describe('financial sources and collector locking', () => {
  it('binds financial source posting, replay and close locks to signed authority', async () => {
    const migration = await readFile(
      resolve(
        import.meta.dirname,
        '../../migrations/202609021803_tenant_financial_source_journals.sql',
      ),
      'utf8',
    );
    for (const invariant of [
      'journal_finance_source_once',
      'DEFERRABLE INITIALLY DEFERRED',
      'accounting_lock_financial_request',
      'classification_required',
      'NEW.posted_at AT TIME ZONE',
      'c.support_grant_id IS NOT NULL',
    ]) {
      expect(migration).toContain(invariant);
    }
    const attribution = await readFile(
      resolve(
        import.meta.dirname,
        '../../migrations/202609021804_tenant_finance_attribution_classification.sql',
      ),
      'utf8',
    );
    expect(attribution).toContain('finance audit attribution must match signed request');
  });
  it('keeps classification immutable, currency-exact and date-bound on reversal', async () => {
    const classification = await readFile(
      resolve(
        import.meta.dirname,
        '../../migrations/202609021805_tenant_accounting_classification.sql',
      ),
      'utf8',
    );
    expect(classification).toContain('FORCE ROW LEVEL SECURITY');
    expect(classification).toContain('operations_reject_append_only_mutation');
    const reversal = await readFile(
      resolve(
        import.meta.dirname,
        '../../migrations/202609021806_tenant_classified_source_reversals.sql',
      ),
      'utf8',
    );
    expect(reversal).toContain('classify_accounting_journal.source_id');
    expect(reversal).toContain('GROUP BY');
    expect(reversal).toContain('HAVING');
  });
  it('mediates collector locks without granting raw table update rights', async () => {
    const migration = await readFile(
      resolve(import.meta.dirname, '../../migrations/202609021807_tenant_collect_payment_lock.sql'),
      'utf8',
    );
    for (const invariant of [
      'SECURITY DEFINER SET search_path=pg_catalog,public',
      "c.permission<>'tenant.payment.post'",
      "c.action<>'tenant.collection.evidence.record'",
      'a.collector_user_id::text=c.actor_id',
      'operations_scope_allows_route',
      'FOR UPDATE OF a,g',
      'FROM PUBLIC',
    ]) {
      expect(migration).toContain(invariant);
    }
    expect(migration).not.toMatch(/GRANT\s+(?:UPDATE|SELECT).*TABLE/i);
  });
});
