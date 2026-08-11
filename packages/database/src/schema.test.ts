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

  it('versions tenant membership authorization-sensitive changes', async () => {
    const migrationUrl = new URL(
      '../migrations/202608111300_tenant_membership_authorization.sql',
      import.meta.url,
    );
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    expect(migration).toContain('ADD COLUMN authorization_version bigint NOT NULL DEFAULT 1');
    expect(migration).toContain('tenant_memberships_authorization_version_check');
    expect(migration).toContain('tenant_memberships_bump_authorization_version');
    for (const field of ['NEW.role_key', 'NEW.permissions', 'NEW.scope', 'NEW.active']) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION bump_tenant_membership_authorization_version() FROM PUBLIC',
    );
  });

  it('uses tenant-isolated immutable journals and locked allocation guards for finance', async () => {
    const migrationUrl = new URL(
      '../migrations/202608111230_tenant_finance_journal.sql',
      import.meta.url,
    );
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    for (const table of ['finance_invoices', 'finance_payments', 'finance_payment_allocations']) {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('posted finance records are append-only');
    expect(migration).toContain('allocated_minor bigint NOT NULL DEFAULT 0');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('maintain_finance_allocation_guards');
    expect(migration).toContain("finance_currency AS ENUM ('USD', 'LBP')");
    expect(migration).toContain('ON finance_payment_allocations');
    expect(migration).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE');
  });

  it('atomically appends protected finance audit outbox evidence with stable conflict codes', async () => {
    const migrationUrl = new URL(
      '../migrations/202608111530_finance_audit_outbox_and_conflicts.sql',
      import.meta.url,
    );
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    expect(migration).toContain('CREATE TABLE finance_audit_outbox');
    expect(migration).toContain('ALTER TABLE finance_audit_outbox FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE FUNCTION append_finance_audit_outbox()');
    expect(migration).toContain('AFTER INSERT ON finance_invoices');
    expect(migration).toContain('AFTER INSERT ON finance_payments');
    expect(migration).toContain('AFTER INSERT ON finance_payment_allocations');
    expect(migration).toContain('finance audit outbox evidence is immutable');
    expect(migration).toContain("ERRCODE = ''P4090''");
    expect(migration).toContain("ERRCODE = ''P4091''");
    expect(migration).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE finance_audit_outbox',
    );
  });

  it('upgrades finance audit evidence under a dedicated least-privilege relay identity', async () => {
    const migrationUrl = new URL(
      '../migrations/202608111700_finance_audit_relay_security.sql',
      import.meta.url,
    );
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

    expect(
      migration.indexOf('DROP TRIGGER finance_audit_outbox_protect_update_or_delete'),
    ).toBeLessThan(migration.indexOf('UPDATE finance_audit_outbox'));
    expect(migration.indexOf('UPDATE finance_audit_outbox')).toBeLessThan(
      migration.indexOf('CREATE TRIGGER finance_audit_outbox_protect_update_or_delete'),
    );
    expect(migration).toContain('clock_timestamp()');
    expect(migration).toContain('ADD COLUMN request_reference text');
    expect(migration).toContain("current_setting('app.finance_support_grant_id', true)");
    expect(migration).toContain('complete authorized finance request context is required');
    expect(migration).toContain(
      'ALTER TABLE finance_audit_outbox OWNER TO orvex_finance_audit_relay_owner',
    );
    expect(migration).toContain('REVOKE ALL ON TABLE finance_audit_outbox FROM orvex_runtime');
    expect(migration).toContain('CREATE FUNCTION list_finance_audit_relay_tenants()');
    expect(migration).toContain('GRANT SELECT ON TABLE finance_audit_outbox');
    expect(migration).toContain('FROM orvex_finance_audit_relay');
  });

  it('keeps relay role bootstrap independent from legacy adoption and SET-only on PostgreSQL 18', async () => {
    const bootstrapUrl = new URL(
      '../../../infra/docker/postgres/admin/bootstrap-finance-audit-relay-roles.sh',
      import.meta.url,
    );
    const provisionUrl = new URL(
      '../../../infra/docker/postgres/admin/provision-existing-database.sh',
      import.meta.url,
    );
    const bootstrap = await readFile(fileURLToPath(bootstrapUrl), 'utf8');
    const provision = await readFile(fileURLToPath(provisionUrl), 'utf8');

    expect(bootstrap).not.toContain('adopt-legacy-baseline');
    expect(bootstrap).toContain('WITH ADMIN FALSE, INHERIT FALSE, SET TRUE');
    expect(provision.indexOf('CREATE ROLE orvex_owner')).toBeLessThan(
      provision.indexOf('bootstrap-finance-audit-relay-roles.sh'),
    );
    expect(provision.indexOf('bootstrap-finance-audit-relay-roles.sh')).toBeLessThan(
      provision.indexOf('adopt-legacy-baseline.mjs'),
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
    expect(adoption).toContain('SET LOCAL search_path TO pg_catalog');
    expect(adoption).toContain('FROM public.support_grants');
    expect(adoption).toContain('refuses a pre-existing _orvex_migrations ledger');
    expect(adoption).toContain('FROM pg_rewrite');
    expect(adoption).toContain('attribute.attacl::text AS privileges');
    expect(adoption).toContain('collation_namespace.nspname');
    expect(adoption).toContain('OR parent_namespace.nspname');
    expect(manifest).toContain('assertExactCatalogManifest');
    expect(manifest).toContain('normalizeCatalogRows');
    expect(harness).toContain('await adoptLegacyBaseline({');
    expect(harness).not.toContain('CREATE TABLE public._orvex_migrations');
    expect(harness).not.toContain('REASSIGN OWNED BY');
  });
});
