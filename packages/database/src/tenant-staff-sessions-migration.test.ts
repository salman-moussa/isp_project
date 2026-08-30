import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  import.meta.dirname,
  '../migrations/202608300100_control_tenant_staff_sessions.sql',
);

describe('tenant staff sessions migration', () => {
  it('guards session reads/revocation with recent MFA and immutable tenant audit evidence', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('assert_tenant_staff_administrator');
    expect(migration).toContain("'tenant.staff.sessions.read'");
    expect(migration).toContain("'tenant.staff.session.revoke'");
    expect(migration).toContain('use sign out to revoke the current administrator session');
    expect(migration).toContain("revoke_reason='tenant_admin_revoked'");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).not.toContain('GRANT SELECT ON auth_sessions');
  });
});
