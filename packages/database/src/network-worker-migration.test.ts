import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/202608112500_tenant_network_worker.sql', import.meta.url)),
  'utf8',
);

describe('Network Worker migration contract', () => {
  it('uses a dedicated runtime with function-only queue access', () => {
    expect(migration).toContain("rolname='orvex_network_worker'");
    expect(migration).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA network_worker');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE).*orvex_network_worker/);
  });

  it('serializes claims and detects changed idempotent payloads', () => {
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain("ERRCODE='N4090'");
    expect(migration).toContain('lease_token=gen_random_uuid()');
  });

  it('atomically bridges scoped Operations actions and fails closed without a binding', () => {
    expect(migration).toContain('CREATE TABLE network_worker.service_bindings');
    expect(migration).toContain('CREATE TRIGGER operations_network_action_to_worker');
    expect(migration).toContain('PERFORM network_worker.enqueue_job(request,clock_timestamp())');
    expect(migration).toContain('subscriber service has no active network binding');
    expect(migration).toContain('NEW.delivered_at:=clock_timestamp()');
    expect(migration).not.toMatch(/GRANT .*service_bindings.*orvex_runtime/);
  });
});
