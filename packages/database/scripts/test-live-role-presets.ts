import assert from 'node:assert/strict';
import postgres from 'postgres';
import { tenantRolePresets, tenantRoles } from '@isp/contracts';

/**
 * Live check that the database role presets (`tenant_role_permissions`) match the contracts
 * presets for every canonical tenant role, so staff created or re-assigned through the product
 * receive exactly the catalogue the API and UI expect.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
if (!adminUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Role preset check requires SALES_TEST_ADMIN_DATABASE_URL.');
  }
  console.log('Role preset check skipped: live database URL is not configured.');
  process.exit(0);
}
const target = new URL(adminUrl);
assert(
  ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
  'Role preset check is restricted to local isp_test.',
);
const admin = postgres(adminUrl, { max: 1, prepare: false });
try {
  for (const role of tenantRoles) {
    const [row] = await admin.unsafe<{ permissions: string[] | null }[]>(
      'SELECT tenant_role_permissions($1) AS permissions',
      [role],
    );
    assert.ok(row?.permissions, `database preset missing for ${role}`);
    assert.deepEqual(
      [...row.permissions].sort(),
      [...tenantRolePresets[role].permissions].sort(),
      `database preset for ${role} differs from the contracts preset`,
    );
  }
  const [unknown] = await admin.unsafe<{ permissions: string[] | null }[]>(
    'SELECT tenant_role_permissions($1) AS permissions',
    ['administrator'],
  );
  assert.equal(unknown?.permissions ?? null, null, 'legacy role key yields no preset');
  const [legacy] = await admin.unsafe<{ count: number }[]>(
    "SELECT count(*)::integer AS count FROM tenant_memberships WHERE role_key='administrator'",
  );
  assert.equal(legacy?.count, 0, 'no membership keeps the legacy administrator key');
  process.stdout.write(`Role presets match the contracts for ${tenantRoles.length} roles.\n`);
} finally {
  await admin.end({ timeout: 5 });
}
