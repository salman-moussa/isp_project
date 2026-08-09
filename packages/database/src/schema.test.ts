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
});
