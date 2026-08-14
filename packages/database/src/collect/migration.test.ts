import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/202608112300_tenant_collect_sync.sql', import.meta.url)),
  'utf8',
);
const ownerMediationMigration = readFileSync(
  fileURLToPath(
    new URL(
      '../../migrations/202608112610_tenant_collect_device_owner_mediation.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('Collect tenant migration security contract', () => {
  it('stores only fixed-size token digests and rechecks membership on access and refresh', () => {
    expect(migration).toContain('access_token_digest bytea');
    expect(migration).toContain('refresh_token_digest bytea');
    expect(migration).toContain('octet_length(access_token_digest) = 32');
    expect(migration).toMatch(
      /CREATE FUNCTION authenticate_collect_device[\s\S]*FROM tenant_memberships membership/,
    );
    expect(migration).not.toMatch(/source_session_id uuid NOT NULL REFERENCES sessions/);
    expect(migration).toContain('Canonical source-session');
    expect(migration).toMatch(
      /CREATE FUNCTION rotate_collect_device_tokens[\s\S]*FOR UPDATE OF device/,
    );
    expect(migration).not.toMatch(/access_token\s+text|refresh_token\s+text/);
  });

  it('enforces per-device operation identity, order, immutable evidence, and bounded audit relay', () => {
    expect(migration).toContain('PRIMARY KEY (tenant_id, device_id, operation_id)');
    expect(migration).toContain('UNIQUE (tenant_id, device_id, sequence)');
    expect(migration).toContain("payload_hash ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain('CREATE FUNCTION protect_collect_evidence()');
    expect(migration).toContain('least(coalesce(batch_size,100),500)');
    for (const table of [
      'collect_sync_operations',
      'collect_reconciliation_submissions',
      'collect_reconciliation_approvals',
      'collect_receipt_print_events',
      'collect_assignment_changes',
      'collect_audit_outbox',
    ]) {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('ALTER TABLE collect_devices FORCE ROW LEVEL SECURITY');
    expect(ownerMediationMigration).toContain(
      'ALTER TABLE public.collect_devices NO FORCE ROW LEVEL SECURITY',
    );
  });

  it('keeps USD/LBP separate and requires a different current manager for discrepancy approval', () => {
    expect(migration).toContain('currency finance_currency NOT NULL');
    expect(migration).toContain("status = 'pending_approval'");
    expect(migration).toContain(
      "manager.permissions @> ARRAY['tenant.collection.reconcile']::text[]",
    );
  });
});
