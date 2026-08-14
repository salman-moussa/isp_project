import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../migrations/202608112200_tenant_operations_core.sql',
  import.meta.url,
);

describe('tenant Operations migration controls', () => {
  it('branches scope validation before reading table-specific NEW fields', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain("IF TG_TABLE_NAME = 'operations_locations' THEN");
    expect(migration).toContain("ELSIF TG_TABLE_NAME = 'operations_subscribers' THEN");
    expect(migration).not.toContain("TG_TABLE_NAME = 'operations_subscribers' AND NOT EXISTS");
  });

  it('authorizes through a signed protected context rather than spoofable GUCs', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain(
      'begin_operations_request_context(attestation_text text, signature_hex text)',
    );
    expect(migration).toContain("encode(hmac(convert_to(attestation_text, 'UTF8')");
    expect(migration).toContain('operations_request_contexts');
    expect(migration).toContain('operations_scope_allows_arrays');
    expect(migration).not.toContain("current_setting(''app.tenant_id''");
    expect(migration).toContain('REVOKE ALL ON TABLE operations_context_keys');
  });

  it('enforces branch, area, route, and record scope in schema and RLS', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    for (const value of [
      'operations_branches',
      'operations_areas',
      'operations_routes',
      'branch_ids uuid[]',
      'area_ids uuid[]',
      'route_ids uuid[]',
      'record_ids uuid[]',
    ]) {
      expect(migration).toContain(value);
    }
    expect(migration).toContain('validate_operations_scope_links');
    expect(migration).toContain('operations_scope_allows_payment_request');
    expect(migration).toContain('operations_scope_allows_installation');
  });

  it('uses effective immutable billing inputs and prevents overlapping or duplicate service periods', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('operations_plan_versions');
    expect(migration).toContain('operations_billing_policies');
    expect(migration).toContain("operations_rounding_mode AS ENUM ('half_up', 'down', 'up')");
    expect(migration).toContain('billing period overlaps an existing run');
    expect(migration).toContain('operations_invoice_preparations_service_period_key');
  });

  it('derives collector evidence and protects linear financial correction chains', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('derive_collector_assignment_amount');
    expect(migration).toContain('derive_collector_evidence_amount');
    expect(migration).toContain('derive_collector_reconciliation_totals');
    expect(migration).toContain('difference_minor = 0 AND approved_by IS NULL');
    expect(migration).toContain('payment correction must extend the current tail');
    expect(migration).toContain('payment reversal must reverse an earlier correction allocation');
  });

  it('atomically records complete mutation evidence and fails network work closed', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    for (const value of [
      'operations_audit_outbox',
      'before_value jsonb',
      'after_value jsonb',
      'idempotency_key text NOT NULL',
      "result text NOT NULL CHECK (result = 'allowed')",
    ]) {
      expect(migration).toContain(value);
    }
    expect(migration).toContain('AFTER INSERT OR UPDATE OR DELETE');
    expect(migration).toContain('operations_platform_subscription_events');
    expect(migration).toContain(
      "tenant_status IS NULL OR tenant_status NOT IN ('trial', 'active')",
    );
    expect(migration).toContain('network payload does not match action schema');
    expect(migration).toContain('operations_configuration_no_secret_keys');
  });

  it('enforces installation and support transition prerequisites in PostgreSQL', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('validate_installation_event_transition');
    expect(migration).toContain("jsonb_typeof(NEW.evidence->'signalTest') = 'string'");
    expect(migration).toContain('service is not pending installation');
    expect(migration).toContain('validate_issue_event_transition');
    expect(migration).toContain("jsonb_typeof(NEW.evidence->'resolutionCode') = 'string'");
  });

  it('rejects a conflicting commercial-state replay for the same source event', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain(
      'platform subscription event identity conflicts with existing evidence',
    );
    expect(migration).toContain('recorded_at=source_occurred_at');
  });
});
