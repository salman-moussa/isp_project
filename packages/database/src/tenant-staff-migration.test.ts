import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tenantRoles } from '@isp/contracts';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  import.meta.dirname,
  '../migrations/202608290100_control_tenant_staff_lifecycle.sql',
);

describe('tenant staff lifecycle migration', () => {
  it('guards staff changes, invitations, session invalidation and last-owner continuity', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    for (const role of tenantRoles) expect(migration).toContain(`'${role}'`);
    expect(migration).toContain('ALTER TABLE tenant_staff_invitations FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('assert_tenant_staff_administrator');
    expect(migration).toContain("mfa_verified_at<p_now-interval '10 minutes'");
    expect(migration).toContain("revoke_reason='tenant_membership_changed'");
    expect(migration).toContain('revoke_tenant_staff_invitation');
    expect(migration).toContain("'tenant.staff.invitation.revoke'");
    expect(migration).toContain('the last active ISP owner cannot be removed');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE).*tenant_staff_invitations/iu);
  });
});
