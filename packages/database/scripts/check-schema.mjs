import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migration = await readFile(resolve('migrations/0000_identity_tenancy_audit.sql'), 'utf8');
const requiredFragments = [
  'CREATE TABLE tenant_memberships',
  'CREATE TABLE support_grants',
  'CREATE TABLE audit_events',
  'ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY',
  'ALTER TABLE support_grants FORCE ROW LEVEL SECURITY',
  'ALTER TABLE audit_events FORCE ROW LEVEL SECURITY',
  'ALTER TABLE tenant_dashboard_snapshots FORCE ROW LEVEL SECURITY',
  'CREATE TRIGGER audit_events_no_update_or_delete',
  "current_setting('app.tenant_id', true)",
];

const missing = requiredFragments.filter((fragment) => !migration.includes(fragment));
if (missing.length > 0) {
  console.error(`Schema safety check failed. Missing: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('Schema safety check passed: RLS and append-only audit controls are present.');
}
