import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfiguredMigrationTargets } from '../scripts/migrate.mjs';

const packageRoot = resolve(import.meta.dirname, '..');

describe('database-plane migration manifest', () => {
  it('classifies every immutable migration into an explicit database plane', async () => {
    const names = (await readdir(resolve(packageRoot, 'migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const scopes = JSON.parse(
      await readFile(resolve(packageRoot, 'migration-scopes.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(Object.keys(scopes).sort()).toEqual(names);
    expect(new Set(Object.values(scopes))).toEqual(new Set(['both', 'control', 'tenant']));
    expect(scopes['202608112100_control_center_core.sql']).toBe('control');
    expect(scopes['202608112200_tenant_operations_core.sql']).toBe('tenant');
    expect(scopes['202608111230_tenant_finance_journal.sql']).toBe('tenant');
    expect(scopes['202608111300_tenant_membership_authorization.sql']).toBe('control');
  });

  it('requires distinct configured databases and assigns an explicit plane to each', () => {
    expect(
      resolveConfiguredMigrationTargets({
        CONTROL_DATABASE_MIGRATION_URL: 'postgres://control',
        TENANT_DATABASE_MIGRATION_URL: 'postgres://tenant',
      }),
    ).toEqual([
      { databaseUrl: 'postgres://control', databaseScope: 'control' },
      { databaseUrl: 'postgres://tenant', databaseScope: 'tenant' },
    ]);

    expect(() =>
      resolveConfiguredMigrationTargets({
        CONTROL_DATABASE_MIGRATION_URL: 'postgres://shared',
        TENANT_DATABASE_MIGRATION_URL: 'postgres://shared',
      }),
    ).toThrow(/separate databases/);
  });
});
