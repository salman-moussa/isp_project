import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { tenantRolePresets, tenantRoles } from '@isp/contracts';

/**
 * Live check that the database role presets (`tenant_role_permissions`) match the contracts
 * presets for every canonical tenant role, and that the tenant-aware canonicalisation turns a
 * legacy bootstrap membership ('administrator' with an old permission snapshot) into the canonical
 * administrator preset under forced row-level security, in both the control and the tenant mirror.
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
const tenantId = randomUUID();
const userId = randomUUID();
const canonical = [...tenantRolePresets.isp_administrator.permissions].sort();
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

  // A legacy bootstrap membership: non-canonical key and a permission snapshot from August.
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Preset proof','Preset proof','active')",
      [tenantId, `PRESET-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Legacy administrator','not-a-login')",
      [userId, `${userId}@presets.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope,active) VALUES($1,$2,'administrator',ARRAY['tenant.dashboard.view','tenant.billing.prepare','tenant.user.administer'],'{}'::jsonb,true)",
      [tenantId, userId],
    );
  });
  const [control] = await admin.unsafe<{ changed: number }[]>(
    'SELECT canonicalize_tenant_memberships() AS changed',
  );
  assert.ok((control?.changed ?? 0) >= 1, 'canonicalisation reports the legacy row');
  const [mirror] = await admin.unsafe<{ changed: number }[]>(
    'SELECT mirror_canonical_admin_memberships() AS changed',
  );
  assert.ok(mirror !== undefined, 'mirror alignment runs');
  const [fixed] = await admin.unsafe<{ role_key: string; permissions: string[] }[]>(
    'SELECT role_key, permissions FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',
    [tenantId, userId],
  );
  assert.equal(fixed?.role_key, 'isp_administrator');
  assert.deepEqual([...(fixed?.permissions ?? [])].sort(), canonical);
  const [again] = await admin.unsafe<{ changed: number }[]>(
    'SELECT canonicalize_tenant_memberships() AS changed',
  );
  assert.equal(again?.changed, 0, 'a second run changes nothing');
  const [legacy] = await admin.unsafe<{ count: number }[]>(
    "SELECT count(*)::integer AS count FROM tenant_memberships WHERE role_key='administrator'",
  );
  assert.equal(legacy?.count, 0, 'no membership keeps the legacy administrator key');
  process.stdout.write(
    `Role presets match the contracts for ${tenantRoles.length} roles; legacy membership canonicalised.\n`,
  );
} finally {
  await admin.end({ timeout: 5 });
}
