import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseline = await readFile(resolve('migrations/0000_identity_tenancy_audit.sql'), 'utf8');
const hardening = await readFile(
  resolve('migrations/202608092100_harden_runtime_roles.sql'),
  'utf8',
);
const securityAudit = await readFile(
  resolve('migrations/202608100030_control_security_audit.sql'),
  'utf8',
);
const migration = `${baseline}\n${hardening}\n${securityAudit}`;
const requiredFragments = [
  'CREATE TABLE tenant_memberships',
  'CREATE TABLE support_grants',
  'CREATE TABLE audit_events',
  'ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY',
  'ALTER TABLE support_grants FORCE ROW LEVEL SECURITY',
  'ALTER TABLE audit_events FORCE ROW LEVEL SECURITY',
  'ALTER TABLE tenant_dashboard_snapshots FORCE ROW LEVEL SECURITY',
  'CREATE TRIGGER audit_events_no_update_or_delete',
  'CREATE TRIGGER audit_events_no_truncate',
  'GRANT SELECT, INSERT ON TABLE audit_events TO orvex_runtime',
  'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM orvex_runtime',
  'CREATE TABLE security_events',
  'CREATE TRIGGER security_events_no_truncate',
  'GRANT INSERT ON TABLE security_events TO orvex_runtime',
  "current_setting('app.tenant_id', true)",
];

const missing = requiredFragments.filter((fragment) => !migration.includes(fragment));
if (missing.length > 0) {
  console.error(`Schema safety check failed. Missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(
    'Schema safety check passed: forced RLS, runtime grants, and append-only audit controls are present.',
  );
}
