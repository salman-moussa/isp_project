import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const recoveryMigration = resolve(
  import.meta.dirname,
  '../../migrations/202609021000_tenant_billing_recovery_dunning.sql',
);
const scopedPolicyMigration = resolve(
  import.meta.dirname,
  '../../migrations/202609021001_tenant_billing_prepare_policy_read.sql',
);

describe('billing recovery migrations', () => {
  it('persists immutable per-service recovery and human-governed dunning evidence', async () => {
    const migration = await readFile(recoveryMigration, 'utf8');
    expect(migration).toContain('CREATE TABLE operations_billing_run_items');
    expect(migration).toContain('CREATE TABLE operations_dunning_policy_versions');
    expect(migration).toContain('CREATE TABLE operations_dunning_cases');
    expect(migration).toContain('CREATE TABLE operations_dunning_events');
    expect(migration).toContain('operations_billing_run_items_append_only');
    expect(migration).toContain('operations_dunning_events_append_only');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).not.toContain('operations_network_action_outbox');
  });

  it('permits only signed invoice preparation to read branch-level legal policy', async () => {
    const migration = await readFile(scopedPolicyMigration, 'utf8');
    expect(migration).toContain('operations_billing_policies_recurring_prepare_read');
    expect(migration).toContain("context_row.action IN ('tenant.billing.prepare'");
    expect(migration).toContain("context_row.permission='tenant.invoice.create'");
    expect(migration).toContain(
      'operations_billing_policies.branch_id=ANY(context_row.branch_ids)',
    );
    expect(migration).toContain('202609021001_tenant_billing_prepare_policy_read.sql');
  });
});
