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
    expect(migration).toContain('ALTER TABLE operations_chart_of_accounts FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE operations_journal_entries FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE operations_journal_lines FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE operations_accounting_periods FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('seed_tenant_default_chart_of_accounts');
  });
});
