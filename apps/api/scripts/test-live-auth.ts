import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, PostgresAuthRepository } from '@isp/database';
import postgres from 'postgres';
import { AuthService, InvalidSessionError, hashPassword } from '../src/auth-service.js';

const migrationUrl = required('AUTH_TEST_MIGRATION_URL');
const controlUrl = required('AUTH_TEST_CONTROL_URL');
const runtimeUrl = required('AUTH_TEST_RUNTIME_URL');
const owner = postgres(migrationUrl, { max: 1, prepare: false });
const control = createDatabase(controlUrl);
const runtime = postgres(runtimeUrl, { max: 1, prepare: false });

const userId = randomUUID();
const email = `auth-live-${userId}@example.test`;
const password = 'correct horse battery staple';
const passwordHash = await hashPassword(password);

try {
  await owner.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`
      INSERT INTO users(id,account_kind,email,display_name,password_hash,mfa_required)
      VALUES (${userId}::uuid,'platform',${email},'Auth Live User',${passwordHash},false)
    `;
    await transaction`
      INSERT INTO platform_authorizations(user_id,roles,permissions)
      VALUES (${userId}::uuid,ARRAY['operator'],ARRAY['platform.tenant.view'])
    `;
  });

  const service = new AuthService(
    new PostgresAuthRepository(control.db),
    { issue: async (claims, expiresAt) => JSON.stringify({ claims, expiresAt }) },
    {
      start: async ({ challengeId }) => ({ adapterReference: challengeId }),
      verify: async () => true,
    },
    { deliver: async () => undefined },
    { tokenDigestSecret: new Uint8Array(32).fill(7) },
  );
  const evidence = { requestId: randomUUID(), ipAddress: '127.0.0.1' };
  const login = await service.login({ email, password, audience: 'platform' }, evidence);
  assert.equal(login.status, 'authenticated');
  if (login.status !== 'authenticated') throw new Error('Expected an authenticated session.');

  const [{ active }] = await runtime<{ active: boolean }[]>`
    SELECT is_auth_session_active(${login.sessionId}::uuid,${userId}::uuid,clock_timestamp()) AS active
  `;
  assert.equal(active, true, 'new auth session must be accepted by canonical validation');

  await owner.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`
      UPDATE platform_authorizations SET permissions=ARRAY['platform.tenant.view','platform.plan.manage']
      WHERE user_id=${userId}::uuid
    `;
  });
  const [{ active: activeAfterNarrowing }] = await runtime<{ active: boolean }[]>`
    SELECT is_auth_session_active(${login.sessionId}::uuid,${userId}::uuid,clock_timestamp()) AS active
  `;
  assert.equal(activeAfterNarrowing, false, 'authorization version change must invalidate session');
  await assert.rejects(
    service.refresh(login.refreshToken, { ...evidence, requestId: randomUUID() }),
    InvalidSessionError,
  );

  process.stdout.write(
    'Authentication integration passed: login, canonical session validation, rotation invalidation.\n',
  );
} finally {
  await Promise.all([
    owner.end({ timeout: 5 }),
    control.client.end({ timeout: 5 }),
    runtime.end({ timeout: 5 }),
  ]);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
