import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from './migrate.mjs';

const migrationUrl = process.env.FINANCE_AUDIT_UPGRADE_MIGRATION_DATABASE_URL;
const bootstrapUrl = process.env.FINANCE_AUDIT_UPGRADE_BOOTSTRAP_DATABASE_URL;
if (!migrationUrl || !bootstrapUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Finance audit upgrade integration requires bootstrap and migration URLs.');
  }
  console.log(
    'Finance audit upgrade integration skipped: live PostgreSQL URLs are not configured.',
  );
  process.exit(0);
}

const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const bootstrap = postgres(bootstrapUrl, { max: 1, prepare: false });
const tenantId = randomUUID();
const actorId = randomUUID();
const pendingInvoiceId = randomUUID();
const deliveredPaymentId = randomUUID();

try {
  await assertRelayRolesAbsent('the empty legacy fixture must begin without relay roles');
  await runRolesOnlyBootstrap();
  await assertSetOnlyOwnerMembership();
  await bootstrap.unsafe(`
    REVOKE orvex_finance_audit_relay_owner FROM orvex_owner;
    REVOKE ALL ON DATABASE isp_finance_upgrade_test FROM orvex_finance_audit_relay;
    REVOKE ALL ON SCHEMA public FROM orvex_finance_audit_relay;
    DROP ROLE orvex_finance_audit_relay;
    DROP ROLE orvex_finance_audit_relay_owner;
  `);

  await migrateThrough('202608111530_finance_audit_outbox_and_conflicts.sql', migrationUrl);
  await assertRelayRolesAbsent('the advanced 1530 fixture must begin without relay roles');

  const seeded = await bootstrap.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction`
      INSERT INTO tenants (id, code, brand_name, legal_name)
      VALUES (${tenantId}, ${`upgrade-${tenantId}`}, 'Upgrade ISP', 'Upgrade ISP SAL')
    `;
    await transaction`
      INSERT INTO finance_invoices
        (id, tenant_id, document_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${pendingInvoiceId}, ${tenantId}, 'UPGRADE-INV-001', 100, 'USD',
        'upgrade-pending-001', ${actorId}, '2026-08-11T09:00:00.000Z')
    `;
    await transaction`
      INSERT INTO finance_payments
        (id, tenant_id, receipt_number, amount_minor, currency, idempotency_key, actor_id, posted_at)
      VALUES (${deliveredPaymentId}, ${tenantId}, 'UPGRADE-PAY-001', 100, 'USD',
        'upgrade-delivered-001', ${actorId}, '2026-08-11T09:01:00.000Z')
    `;
    const events = await transaction`
      SELECT event_id, source_entry_id, delivered_at
      FROM finance_audit_outbox
      ORDER BY source_entry_id
    `;
    const paymentEvent = events.find((event) => event.source_entry_id === deliveredPaymentId);
    assert.ok(paymentEvent);
    await transaction`
      SELECT mark_finance_audit_outbox_delivered(
        ${paymentEvent.event_id}, '2026-08-11T09:02:00.000Z'
      )
    `;
    return events.map((event) => ({
      eventId: event.event_id,
      sourceEntryId: event.source_entry_id,
    }));
  });

  await runRolesOnlyBootstrap();
  await assertSetOnlyOwnerMembership();
  await migrate(migrationUrl, { databaseScope: 'tenant' });

  const upgraded = await bootstrap.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return transaction`
      SELECT event_id, source_entry_id, session_id, request_id, ip_address, permission,
             reason, client_posted_at, delivered_at
      FROM finance_audit_outbox
      ORDER BY source_entry_id
    `;
  });
  assert.equal(upgraded.length, 2);
  assert.deepEqual(
    upgraded.map((event) => ({ eventId: event.event_id, sourceEntryId: event.source_entry_id })),
    seeded,
    'the forward upgrade must preserve both immutable evidence identities',
  );
  assert.ok(upgraded.every((event) => event.session_id === 'legacy-unavailable'));
  assert.ok(upgraded.every((event) => event.request_id === event.event_id));
  assert.ok(upgraded.every((event) => event.client_posted_at instanceof Date));
  assert.equal(
    upgraded.find((event) => event.source_entry_id === pendingInvoiceId)?.delivered_at,
    null,
  );
  assert.ok(
    upgraded.find((event) => event.source_entry_id === deliveredPaymentId)?.delivered_at instanceof
      Date,
  );

  console.log(
    'Finance audit upgrade integration passed: roles-only bootstrap and pending/delivered evidence preservation.',
  );
} finally {
  await bootstrap.end({ timeout: 5 });
}

async function runRolesOnlyBootstrap(): Promise<void> {
  const composeArguments = [
    'compose',
    '-f',
    'docker-compose.test.yml',
    'exec',
    '-T',
    '-e',
    'DATABASE_BOOTSTRAP_URL=postgresql://orvex_finance_upgrade_bootstrap:test-only-bootstrap-not-production@127.0.0.1:5432/isp_finance_upgrade_test',
    '-e',
    'ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD=test-only-relay-not-production',
    'postgres-finance-upgrade-test',
    'sh',
    '/orvex-admin/bootstrap-finance-audit-relay-roles.sh',
  ];
  await promisify(execFile)('docker', composeArguments, {
    cwd: resolve(migrationsDirectory, '../../..'),
  });
}

async function assertRelayRolesAbsent(message: string): Promise<void> {
  const [{ relay_roles_absent: rolesAbsent }] = await bootstrap`
    SELECT NOT EXISTS (
      SELECT FROM pg_roles
      WHERE rolname IN ('orvex_finance_audit_relay_owner', 'orvex_finance_audit_relay')
    ) AS relay_roles_absent
  `;
  assert.equal(rolesAbsent, true, message);
}

async function assertSetOnlyOwnerMembership(): Promise<void> {
  const [membership] = await bootstrap`
    SELECT member_edge.admin_option, member_edge.inherit_option, member_edge.set_option
    FROM pg_auth_members member_edge
    JOIN pg_roles granted_role ON granted_role.oid = member_edge.roleid
    JOIN pg_roles member_role ON member_role.oid = member_edge.member
    WHERE granted_role.rolname = 'orvex_finance_audit_relay_owner'
      AND member_role.rolname = 'orvex_owner'
  `;
  assert.deepEqual(
    membership,
    { admin_option: false, inherit_option: false, set_option: true },
    'relay ownership must be SET-only and never inherited by the migration owner',
  );
}

async function migrateThrough(lastMigration: string, databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const names = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql') && name.localeCompare(lastMigration) <= 0)
      .sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const contents = await readFile(resolve(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');
      await client.begin(async (transaction) => {
        await transaction.unsafe('SET LOCAL ROLE orvex_owner');
        await transaction.unsafe('SET LOCAL search_path TO public, pg_catalog');
        await transaction.unsafe(`
          CREATE TABLE IF NOT EXISTS public._orvex_migrations (
            name text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        const [applied] = await transaction`
          SELECT checksum FROM public._orvex_migrations WHERE name = ${name}
        `;
        if (applied) {
          assert.equal(applied.checksum, checksum, `applied migration ${name} changed`);
          return;
        }
        await transaction.unsafe(contents);
        await transaction`
          INSERT INTO public._orvex_migrations (name, checksum) VALUES (${name}, ${checksum})
        `;
      });
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}
