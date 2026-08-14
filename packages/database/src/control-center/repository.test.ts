import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ControlCenterAuthorizationError,
  ControlCenterConflictError,
  ControlCenterIdempotencyError,
  ControlCenterPreconditionError,
  mapControlCenterDatabaseError,
} from './repository.js';

describe('Control Center persistence boundary', () => {
  it('maps stable database conflicts to complete public error types', () => {
    expect(mapControlCenterDatabaseError({ code: 'CI409' })).toBeInstanceOf(
      ControlCenterIdempotencyError,
    );
    expect(mapControlCenterDatabaseError({ code: 'CC409' })).toBeInstanceOf(
      ControlCenterConflictError,
    );
    expect(mapControlCenterDatabaseError({ code: 'CC412' })).toBeInstanceOf(
      ControlCenterPreconditionError,
    );
    expect(mapControlCenterDatabaseError({ code: 'CA403' })).toBeInstanceOf(
      ControlCenterAuthorizationError,
    );
  });
  it('keeps runtime away from base-table writes and exposes only guarded functions', async () => {
    const migration = await readFile(
      new URL('../../migrations/202608112100_control_center_core.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE[\s\S]+control_center_audit_events[\s\S]+FROM orvex_control_runtime/,
    );
    expect(migration).toContain(
      'GRANT SELECT ON control_center_client_drilldown, control_center_audit_events',
    );
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]{0,80}orvex_control_runtime/i,
    );
    expect(migration).toContain('guard_control_subscription_write');
    expect(migration).toMatch(/^-- orvex:database=control/);
    expect(migration).not.toContain('ALTER ROLE orvex_control_runtime');
    expect(migration).toContain(
      'begin_control_request_context(attestation_text text,signature_hex text)',
    );
    expect(migration).toContain("encode(hmac(convert_to(attestation_text,'UTF8')");
    expect(migration).toContain('CREATE FUNCTION control_center_readiness()');
    expect(migration).toContain("name = '202608112100_control_center_core.sql'");
    expect(migration).not.toContain('GRANT SELECT ON _orvex_migrations');
  });
  it('makes approval separate, audited, server-timed, and MFA bound', async () => {
    const migration = await readFile(
      new URL('../../migrations/202608112100_control_center_core.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('requester actor and session cannot approve own transition');
    expect(migration).toContain(
      "control_require_context('platform.subscription.manage','transition.approve',true)",
    );
    expect(
      migration.indexOf('SELECT * INTO req FROM control_center_transition_requests'),
    ).toBeLessThan(migration.indexOf("control_claim_idempotency('transition.approve'"));
    expect(migration).toContain("control_append_audit('transition.request'");
    expect(migration).toContain("control_append_audit('transition.approve'");
    expect(migration).toMatch(/occurred_at timestamptz NOT NULL DEFAULT clock_timestamp\(\)/);
  });
  it('serializes package versions, idempotency, allocations, and reversals', async () => {
    const migration = await readFile(
      new URL('../../migrations/202608112100_control_center_core.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('package effective periods cannot overlap');
    expect(migration).toContain('PRIMARY KEY (operation, actor_id, session_id, idempotency_key)');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('allocation reversal must exactly match original');
    expect(migration).toContain('reversal must match an unallocated posting');
    expect(migration).toContain('AND tenant_id=p_tenant FOR UPDATE');
    expect(migration).toContain('canonical subscription start');
  });
});
