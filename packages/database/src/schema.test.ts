import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('tenant database safety migration', () => {
  it('forces row-level security and makes audit events append-only', async () => {
    const migrationUrl = new URL('../migrations/0000_identity_tenancy_audit.sql', import.meta.url);
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    expect(migration).toContain('ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE support_grants FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE audit_events FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE tenant_dashboard_snapshots FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE TRIGGER audit_events_no_update_or_delete');
    expect(migration).toContain("current_setting('app.tenant_id', true)");
    expect(migration).not.toContain('tenant_id IS NULL\n    OR tenant_id');
  });

  it('prevents support requesters from approving their own grants', async () => {
    const migrationUrl = new URL('../migrations/0000_identity_tenancy_audit.sql', import.meta.url);
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');
    expect(migration).toContain('CHECK (approver_id IS NULL OR approver_id <> requester_id)');
  });

  it('gives the runtime role explicit access and rejects every audit mutation', async () => {
    const migrationUrl = new URL(
      '../migrations/202608092100_harden_runtime_roles.sql',
      import.meta.url,
    );
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE audit_events TO orvex_runtime');
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM orvex_runtime',
    );
    expect(migration).toContain('CREATE TRIGGER audit_events_no_truncate');
    expect(migration).toContain('CREATE TRIGGER support_grants_bump_authorization_version');
    expect(migration).toContain('support_grants_permissions_nonempty_check');
    expect(migration).toContain('support_grants_approval_state_check');
    expect(migration).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE orvex_owner');
  });

  it('stores authentication denials in an append-only control-plane sink', async () => {
    const migrationUrl = new URL(
      '../migrations/202608100030_control_security_audit.sql',
      import.meta.url,
    );
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    expect(migration).toContain('CREATE TABLE security_events');
    expect(migration).toContain('CREATE TRIGGER security_events_no_update_or_delete');
    expect(migration).toContain('CREATE TRIGGER security_events_no_truncate');
    expect(migration).toContain('GRANT INSERT ON TABLE security_events TO orvex_runtime');
    expect(migration).toContain('GRANT SELECT ON TABLE _orvex_migrations TO orvex_runtime');
    expect(migration).toContain(
      'REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON TABLE security_events FROM orvex_runtime',
    );
  });

  it('adopts the immutable legacy baseline through one verified bridge', async () => {
    const adoptionUrl = new URL('../scripts/adopt-legacy-baseline.mjs', import.meta.url);
    const adoption = await readFile(fileURLToPath(adoptionUrl), 'utf8');
    const manifestUrl = new URL('../scripts/legacy-baseline-manifest.mjs', import.meta.url);
    const manifest = await readFile(fileURLToPath(manifestUrl), 'utf8');
    const harnessUrl = new URL('../scripts/test-live-postgres.mjs', import.meta.url);
    const harness = await readFile(fileURLToPath(harnessUrl), 'utf8');

    expect(adoption).toContain("createHash('sha256').update(baseline).digest('hex')");
    expect(adoption).toContain('await verifyExactBaselineManifest(transaction, baseline)');
    expect(adoption).toContain('DATABASE_BOOTSTRAP_URL does not target ORVEX_DATABASE_NAME');
    expect(adoption).toContain('INSERT INTO public._orvex_migrations');
    expect(adoption).toContain('ALTER TABLE public.');
    expect(adoption).not.toContain('REASSIGN OWNED BY');
    expect(adoption).toContain('CREATE SCHEMA');
    expect(adoption).toContain('pg_get_constraintdef(constraint_row.oid, true)');
    expect(adoption).toContain('trigger_row.tgqual');
    expect(adoption).toContain('trigger_row.tgattr::text');
    expect(adoption).toContain('trigger_row.tgargs');
    expect(manifest).toContain('assertExactCatalogManifest');
    expect(manifest).toContain('normalizeCatalogRows');
    expect(harness).toContain('await adoptLegacyBaseline({');
    expect(harness).not.toContain('CREATE TABLE public._orvex_migrations');
    expect(harness).not.toContain('REASSIGN OWNED BY');
  });
});
