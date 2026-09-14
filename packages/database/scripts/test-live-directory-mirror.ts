import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { TenantDirectorySnapshot, VerifiedTenantId } from '@isp/contracts';
import {
  applyTenantDirectoryMirror,
  createDatabase,
  listControlTenantIds,
  readTenantDirectory,
} from '../src/index.js';

/**
 * Live proof of the staff directory mirror on PostgreSQL 18: the control-side snapshot of a tenant
 * (tenant row, identities, memberships) applied through `mirror_tenant_directory` creates the rows
 * a tenant database needs for operational references, is idempotent (a second pass changes
 * nothing and bumps no authorization version), never overwrites an existing password hash,
 * deactivates memberships the control database no longer lists, and lets an operational row
 * reference the mirrored membership.
 */
const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
const apiUrl = process.env.TENANT_STAFF_TEST_API_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !apiUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Directory mirror check requires the SALES_TEST and TENANT_STAFF_TEST URLs.');
  }
  console.log('Directory mirror check skipped: live database URLs are not configured.');
  process.exit(0);
}
for (const value of [adminUrl, runtimeUrl, apiUrl]) {
  const target = new URL(value);
  assert(
    ['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/isp_test',
    'Directory mirror check is restricted to local isp_test.',
  );
}
const admin = postgres(adminUrl, { max: 2, prepare: false });
const control = createDatabase(apiUrl);
const tenant = createDatabase(runtimeUrl);
const tenantId = randomUUID() as VerifiedTenantId;
const ownerId = randomUUID();
const cashierId = randomUUID();
const branchId = randomUUID();
try {
  // Control-side fixture: a tenant with an owner (real hash) and a cashier.
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES($1,$2,'Mirror proof','Mirror proof','active')",
      [tenantId, `MIR-${tenantId}`],
    );
    await tx.unsafe(
      "INSERT INTO users(id,account_kind,email,display_name,password_hash) VALUES($1,'tenant',$2,'Mirror owner','real-hash-stays'),($3,'tenant',$4,'Mirror cashier','real-hash-stays')",
      [ownerId, `${ownerId}@mirror.invalid`, cashierId, `${cashierId}@mirror.invalid`],
    );
    await tx.unsafe(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope,active) VALUES($1,$2,'isp_owner',tenant_role_permissions('isp_owner'),'{}'::jsonb,true),($1,$3,'cashier',tenant_role_permissions('cashier'),$4::jsonb,true)",
      [tenantId, ownerId, cashierId, { branchIds: [branchId] }],
    );
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'MIR-B','Mirror branch','فرع المرآة')",
      [branchId, tenantId],
    );
  });
  assert.ok((await listControlTenantIds(control.db)).includes(tenantId));

  const snapshot = await readTenantDirectory(control.db, tenantId);
  assert.ok(snapshot, 'snapshot exists');
  assert.equal(snapshot.tenant.code, `MIR-${tenantId}`);
  assert.equal(snapshot.members.length, 2);
  const cashier = snapshot.members.find((m) => m.userId === cashierId);
  assert.deepEqual(cashier?.scope, { branchIds: [branchId] });
  assert.equal(await readTenantDirectory(control.db, randomUUID() as VerifiedTenantId), null);

  // On this single database the mirror target already holds the rows: nothing changes.
  const first = await applyTenantDirectoryMirror(tenant.db, snapshot);
  assert.deepEqual(
    [
      first.insertedUsers,
      first.updatedUsers,
      first.insertedMembers,
      first.updatedMembers,
      first.deactivatedMembers,
    ],
    [0, 0, 0, 0, 0],
    'same-database pass is a no-op',
  );
  const [hash] = await admin.unsafe<{ password_hash: string }[]>(
    'SELECT password_hash FROM users WHERE id=$1',
    [ownerId],
  );
  assert.equal(hash?.password_hash, 'real-hash-stays', 'existing password hash untouched');
  const [version] = await admin.unsafe<{ v: string }[]>(
    'SELECT authorization_version::text AS v FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',
    [tenantId, ownerId],
  );

  // A snapshot for a tenant the target does not know yet: everything is created.
  const otherTenant = randomUUID();
  const otherUser = randomUUID();
  const fresh: TenantDirectorySnapshot = {
    tenant: {
      id: otherTenant,
      code: `MIR2-${otherTenant}`,
      brandName: 'Mirrored client',
      legalName: 'Mirrored client SAL',
      status: 'active',
      timezone: 'Asia/Beirut',
      defaultLocale: 'en-LB',
      archivedAt: null,
    },
    members: [
      {
        userId: otherUser,
        membershipId: randomUUID(),
        email: `${otherUser}@mirror.invalid`,
        displayName: 'Mirrored technician',
        mfaRequired: true,
        disabledAt: null,
        roleKey: 'installer',
        permissions: ['tenant.installation.manage', 'tenant.installation.view'],
        scope: {},
        active: true,
      },
    ],
  };
  const created = await applyTenantDirectoryMirror(tenant.db, fresh);
  assert.equal(created.insertedUsers, 1);
  assert.equal(created.insertedMembers, 1);
  const [mirroredUser] = await admin.unsafe<{ password_hash: string; mfa_required: boolean }[]>(
    'SELECT password_hash, mfa_required FROM users WHERE id=$1',
    [otherUser],
  );
  assert.equal(mirroredUser?.password_hash, 'mirror$not-a-login', 'placeholder hash on insert');
  assert.equal(mirroredUser?.mfa_required, true);
  // The mirrored tenant and membership can be referenced by operational rows (fixture write
  // outside a signed operations context, so triggers are bypassed as in every other fixture).
  await admin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role='replica'");
    await tx.unsafe(
      "INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar) VALUES($1,$2,'MIR2-B','Mirrored branch','فرع منسوخ')",
      [randomUUID(), otherTenant],
    );
  });
  const [ref] = await admin.unsafe<{ ok: boolean }[]>(
    'SELECT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND active) AS ok',
    [otherTenant, otherUser],
  );
  assert.equal(ref?.ok, true);

  // Role change and removal on the control side flow through: update, then deactivate.
  const changed = await applyTenantDirectoryMirror(tenant.db, {
    ...fresh,
    members: [
      { ...fresh.members[0]!, roleKey: 'network_operator', displayName: 'Mirrored operator' },
    ],
  });
  assert.equal(changed.updatedUsers, 1);
  assert.equal(changed.updatedMembers, 1);
  const removed = await applyTenantDirectoryMirror(tenant.db, { ...fresh, members: [] });
  assert.equal(removed.deactivatedMembers, 1);
  const [inactive] = await admin.unsafe<{ active: boolean; role_key: string }[]>(
    'SELECT active, role_key FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',
    [otherTenant, otherUser],
  );
  assert.equal(inactive?.active, false);
  assert.equal(inactive?.role_key, 'network_operator');

  // The original tenant's authorization version never moved.
  const [after] = await admin.unsafe<{ v: string }[]>(
    'SELECT authorization_version::text AS v FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',
    [tenantId, ownerId],
  );
  assert.equal(after?.v, version?.v, 'no version bump from a no-op mirror');
  await assert.rejects(
    applyTenantDirectoryMirror(tenant.db, { members: [] } as unknown as TenantDirectorySnapshot),
  );
  process.stdout.write('Directory mirror acceptance passed.\n');
} finally {
  await Promise.all([
    admin.end({ timeout: 5 }),
    control.client.end({ timeout: 5 }),
    tenant.client.end({ timeout: 5 }),
  ]);
}
