import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../migrations/202609021810_tenant_inventory_custody.sql',
  import.meta.url,
);

describe('serialized inventory custody migration', () => {
  it('binds warehouse and asset reads to signed installation authority and scope', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('inventory_warehouse_scope_allows');
    expect(migration).toContain('inventory_asset_scope_allows');
    expect(migration).toContain(
      "c.permission IN('tenant.installation.view','tenant.installation.manage')",
    );
    expect(migration).toContain('c.support_grant_id IS NULL');
    expect(migration).toContain('operations_scope_allows_installation');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('makes each handoff versioned, replay-safe, evidenced, and atomically audited', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('operations_inventory_custody_events');
    expect(migration).toContain('UNIQUE(tenant_id,idempotency_key)');
    expect(migration).toContain('UNIQUE(tenant_id,asset_id,version)');
    expect(migration).toContain('asset custody changed; refresh before acting');
    expect(migration).toContain('custody retry key belongs to different content');
    expect(migration).toContain('operations_audit_outbox');
    expect(migration).toContain('inventory_event_immutable');
    expect(migration).toContain('complete bilingual custody evidence is required');
  });

  it('enforces the issue, install, return, and RMA state machine in PostgreSQL', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain("WHEN 'issue'");
    expect(migration).toContain("WHEN 'install'");
    expect(migration).toContain("WHEN 'return'");
    expect(migration).toContain("WHEN 'rma'");
    expect(migration).toContain('custodian must be an active tenant member');
    expect(migration).toContain('only issued or installed equipment can be returned');
  });
});
