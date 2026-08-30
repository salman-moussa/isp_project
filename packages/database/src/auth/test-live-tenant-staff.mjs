import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const adminUrl = process.env.TENANT_STAFF_TEST_ADMIN_DATABASE_URL;
const apiUrl = process.env.TENANT_STAFF_TEST_API_DATABASE_URL;
if (!adminUrl || !apiUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Tenant staff integration requires admin and runtime database URLs.');
  }
  console.log('Tenant staff integration skipped: live control database URLs are not configured.');
  process.exit(0);
}

const admin = postgres(adminUrl, { max: 2 });
const runtime = postgres(apiUrl, { max: 2 });
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const actorId = randomUUID();
const ownerId = randomUUID();
const sessionId = randomUUID();
const invitationId = randomUUID();
const revokedInvitationId = randomUUID();
const routeId = randomUUID();
const now = new Date();

const request = (label) => `${label}-${randomUUID()}`;
const email = (label) => `${label}.${randomUUID()}@staff.invalid`;

async function createInvitation(id, targetEmail, tokenDigest, idempotencyKey, requestId) {
  return asRuntime(
    (transaction) => transaction`
      SELECT * FROM create_tenant_staff_invitation(
        ${id}::uuid, ${tenantId}::uuid, ${actorId}::uuid, ${sessionId}::uuid,
        ${targetEmail}, 'Verified Staff', 'isp_administrator', '{}'::jsonb,
        ${tokenDigest}, ${idempotencyKey}, ${new Date(now.getTime() + 3_600_000)}::timestamptz,
        ${requestId}, '127.0.0.1', 'tenant-staff-live-test', 'Approved live staff lifecycle proof',
        ${now}::timestamptz
      )`,
  );
}

async function asRuntime(work) {
  return runtime.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_control_runtime');
    return work(transaction);
  });
}

try {
  await admin`
    INSERT INTO tenants(id,code,brand_name,legal_name,status) VALUES
      (${tenantId},${`STAFF-${tenantId}`},'Staff lifecycle test','Staff lifecycle test','active'),
      (${otherTenantId},${`STAFF-${otherTenantId}`},'Other tenant','Other tenant','active')`;
  await admin`
    INSERT INTO users(id,account_kind,email,display_name,password_hash,mfa_required) VALUES
      (${actorId},'tenant',${email('admin')},'Staff Administrator','not-a-login',true),
      (${ownerId},'tenant',${email('owner')},'Sole ISP Owner','not-a-login',true)`;
  await admin`
    INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope,active) VALUES
      (${tenantId},${actorId},'isp_administrator',ARRAY['tenant.user.administer'],'{}'::jsonb,true),
      (${tenantId},${ownerId},'isp_owner',ARRAY['tenant.user.administer'],'{}'::jsonb,true)`;
  await admin`
    INSERT INTO auth_sessions(
      id,user_id,audience,tenant_id,authorization_version,current_refresh_digest,
      last_seen_at,idle_expires_at,absolute_expires_at
    ) VALUES (
      ${sessionId},${actorId},'tenant',${tenantId},1,${`refresh-${sessionId}`},${now},
      ${new Date(now.getTime() + 3_600_000)},${new Date(now.getTime() + 86_400_000)}
    )`;

  await assert.rejects(
    createInvitation(
      invitationId,
      email('mfa-denied'),
      `digest-${randomUUID()}`,
      request('idem'),
      request('mfa-denied'),
    ),
    /recent MFA verification is required/i,
  );
  await admin`UPDATE auth_sessions SET mfa_verified_at=${now} WHERE id=${sessionId}`;

  const acceptedEmail = email('accepted');
  const acceptedDigest = `digest-${randomUUID()}`;
  const [created] = await createInvitation(
    invitationId,
    acceptedEmail,
    acceptedDigest,
    request('invite-key'),
    request('invite'),
  );
  assert.equal(created?.invitation_id, invitationId);
  assert.equal(created?.replayed, false);

  const [accepted] = await asRuntime(
    (transaction) => transaction`
    SELECT * FROM accept_tenant_staff_invitation(
      ${acceptedDigest}, 'argon2id-live-proof', ${request('accept')}, '127.0.0.1',
      'tenant-staff-live-test', ${new Date(now.getTime() + 1_000)}::timestamptz
    )`,
  );
  assert.equal(accepted?.outcome, 'created');
  assert.equal(accepted?.tenant_id, tenantId);
  const acceptedUserId = accepted?.user_id;
  assert(acceptedUserId, 'accepted invitation must create a user');

  const [replay] = await asRuntime(
    (transaction) => transaction`
    SELECT * FROM accept_tenant_staff_invitation(
      ${acceptedDigest}, 'ignored', ${request('replay')}, '127.0.0.1',
      'tenant-staff-live-test', ${new Date(now.getTime() + 2_000)}::timestamptz
    )`,
  );
  assert.equal(replay?.outcome, 'invalid', 'an invitation token must be one-time');

  const revokedDigest = `digest-${randomUUID()}`;
  await createInvitation(
    revokedInvitationId,
    email('revoked'),
    revokedDigest,
    request('revoke-key'),
    request('revoke-create'),
  );
  const [revoked] = await asRuntime(
    (transaction) => transaction`
    SELECT revoke_tenant_staff_invitation(
      ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${revokedInvitationId}::uuid,
      ${request('revoke')},'127.0.0.1','tenant-staff-live-test','Invitation intentionally revoked',
      ${new Date(now.getTime() + 3_000)}::timestamptz
    )`,
  );
  assert.equal(revoked?.revoke_tenant_staff_invitation, true);
  const [revokedAccept] = await asRuntime(
    (transaction) => transaction`
    SELECT * FROM accept_tenant_staff_invitation(
      ${revokedDigest}, 'ignored', ${request('revoked-accept')}, '127.0.0.1',
      'tenant-staff-live-test', ${new Date(now.getTime() + 4_000)}::timestamptz
    )`,
  );
  assert.equal(revokedAccept?.outcome, 'invalid');

  const [membership] = await admin`
    SELECT authorization_version FROM tenant_memberships
    WHERE tenant_id=${tenantId} AND user_id=${acceptedUserId}::uuid`;
  const targetSessionId = randomUUID();
  await admin`
    INSERT INTO auth_sessions(
      id,user_id,audience,tenant_id,authorization_version,current_refresh_digest,mfa_verified_at,
      last_seen_at,idle_expires_at,absolute_expires_at
    ) VALUES (
      ${targetSessionId},${acceptedUserId}::uuid,'tenant',${tenantId},${membership.authorization_version},
      ${`refresh-${targetSessionId}`},${now},${now},${new Date(now.getTime() + 3_600_000)},
      ${new Date(now.getTime() + 86_400_000)}
    )`;
  const sessions = await asRuntime(
    (transaction) => transaction`
      SELECT * FROM read_tenant_staff_sessions(
        ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${acceptedUserId}::uuid,
        ${request('sessions-read')},'127.0.0.1','tenant-staff-live-test',
        ${new Date(now.getTime() + 4_500)}::timestamptz
      )`,
  );
  assert(sessions.some((session) => session.session_id === targetSessionId));
  const [adminRevoked] = await asRuntime(
    (transaction) => transaction`
      SELECT revoke_tenant_staff_session(
        ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${acceptedUserId}::uuid,
        ${targetSessionId}::uuid,${request('session-revoke')},'127.0.0.1',
        'tenant-staff-live-test','Lost employee device',
        ${new Date(now.getTime() + 4_700)}::timestamptz
      )`,
  );
  assert.equal(adminRevoked?.revoke_tenant_staff_session, true);
  await assert.rejects(
    asRuntime(
      (transaction) => transaction`
        SELECT revoke_tenant_staff_session(
          ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${actorId}::uuid,
          ${sessionId}::uuid,${request('current-session')},'127.0.0.1',
          'tenant-staff-live-test','Attempt current session revoke',
          ${new Date(now.getTime() + 4_800)}::timestamptz
        )`,
    ),
    /use sign out to revoke the current administrator session/i,
  );

  const authorizationChangeSessionId = randomUUID();
  await admin`
    INSERT INTO auth_sessions(
      id,user_id,audience,tenant_id,authorization_version,current_refresh_digest,mfa_verified_at,
      last_seen_at,idle_expires_at,absolute_expires_at
    ) VALUES (
      ${authorizationChangeSessionId},${acceptedUserId}::uuid,'tenant',${tenantId},
      ${membership.authorization_version},${`refresh-${authorizationChangeSessionId}`},${now},${now},
      ${new Date(now.getTime() + 3_600_000)},${new Date(now.getTime() + 86_400_000)}
    )`;
  const [updated] = await asRuntime(
    (transaction) => transaction`
    SELECT update_tenant_staff_membership(
      ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${acceptedUserId}::uuid,
      'collector',${transaction.json({ routeIds: [routeId] })}::jsonb,true,${request('update')},
      '127.0.0.1','tenant-staff-live-test','Assign verified collector route',
      ${new Date(now.getTime() + 5_000)}::timestamptz
    )`,
  );
  assert(
    Number(updated?.update_tenant_staff_membership) > Number(membership.authorization_version),
  );
  const [targetSession] =
    await admin`SELECT revoked_at,revoke_reason FROM auth_sessions WHERE id=${authorizationChangeSessionId}`;
  assert(targetSession?.revoked_at, 'membership changes must revoke target tenant sessions');
  assert.equal(targetSession?.revoke_reason, 'tenant_membership_changed');

  await assert.rejects(
    asRuntime(
      (transaction) => transaction`
      SELECT update_tenant_staff_membership(
        ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${actorId}::uuid,
        'isp_administrator','{}'::jsonb,false,${request('self-suspend')},'127.0.0.1',
        'tenant-staff-live-test','Attempt self suspension',${new Date(now.getTime() + 6_000)}::timestamptz
      )`,
    ),
    /cannot suspend their own membership/i,
  );
  await assert.rejects(
    asRuntime(
      (transaction) => transaction`
      SELECT update_tenant_staff_membership(
        ${tenantId}::uuid,${actorId}::uuid,${sessionId}::uuid,${ownerId}::uuid,
        'isp_administrator','{}'::jsonb,true,${request('last-owner')},'127.0.0.1',
        'tenant-staff-live-test','Attempt last owner downgrade',${new Date(now.getTime() + 7_000)}::timestamptz
      )`,
    ),
    /last active ISP owner cannot be removed/i,
  );

  await admin`
    INSERT INTO tenant_staff_invitations(
      id,tenant_id,email,display_name,role_key,permissions,scope,token_digest,idempotency_key,
      request_hash,invited_by,expires_at
    ) VALUES (
      ${randomUUID()},${otherTenantId},${email('isolated')},'Isolated Staff','isp_administrator',
      ARRAY['tenant.user.administer'],'{}'::jsonb,${`digest-${randomUUID()}`},${request('isolated-key')},
      ${randomUUID()},${actorId},${new Date(now.getTime() + 3_600_000)}
    )`;
  const visible = await runtime.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_control_runtime');
    await transaction`SELECT set_config('app.tenant_id',${tenantId},true)`;
    return transaction`SELECT tenant_id FROM tenant_staff_invitations`;
  });
  assert(visible.length >= 2);
  assert(
    visible.every((row) => row.tenant_id === tenantId),
    'RLS must hide other tenant invitations',
  );

  const [readiness] = await asRuntime(
    (transaction) => transaction`SELECT * FROM tenant_staff_lifecycle_readiness()`,
  );
  assert.deepEqual(readiness, {
    relations_ready: true,
    migration_ready: true,
    functions_ready: true,
  });
  const [sessionReadiness] = await asRuntime(
    (transaction) => transaction`SELECT * FROM tenant_staff_sessions_readiness()`,
  );
  assert.deepEqual(sessionReadiness, { migration_ready: true, functions_ready: true });
  console.log('Tenant staff live migration/lifecycle checks passed');
} finally {
  await Promise.allSettled([admin.end(), runtime.end()]);
}
