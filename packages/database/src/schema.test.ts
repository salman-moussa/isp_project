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
});
