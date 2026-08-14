import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { adoptLegacyBaseline } from './adopt-legacy-baseline.mjs';
import { migrate } from './migrate.mjs';

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const runtimeUrl = process.env.DATABASE_RUNTIME_URL;
const liveRequired = process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1';
const upgradeBootstrapUrl = process.env.DATABASE_UPGRADE_BOOTSTRAP_URL;
const upgradeMigrationUrl = process.env.DATABASE_UPGRADE_MIGRATION_URL;
const upgradeRuntimeUrl = process.env.DATABASE_UPGRADE_RUNTIME_URL;
const upgradeLegacyOwner = process.env.DATABASE_UPGRADE_LEGACY_OWNER;
const upgradeDatabaseName = process.env.DATABASE_UPGRADE_NAME;
const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const ownerMediatedRlsTables = new Set(['collect_devices']);
const expectedMigrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

if (!migrationUrl || !runtimeUrl) {
  const missing = [
    !migrationUrl && 'DATABASE_MIGRATION_URL',
    !runtimeUrl && 'DATABASE_RUNTIME_URL',
  ].filter(Boolean);
  const message = `Live PostgreSQL safety tests skipped: missing ${missing.join(' and ')}`;
  if (liveRequired) {
    throw new Error(`${message}; ORVEX_REQUIRE_LIVE_POSTGRES=1 forbids skipping`);
  }
  console.log(message);
  process.exit(0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectRejected(action, pattern, description) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(pattern.test(message), `${description} failed for an unexpected reason: ${message}`);
    return;
  }
  throw new Error(`${description} unexpectedly succeeded`);
}

const migrator = postgres(migrationUrl, { max: 1, prepare: false });
const runtime = postgres(runtimeUrl, { max: 1, prepare: false });

const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const supportRequester = randomUUID();
const supportApprover = randomUUID();
const supportGrant = randomUUID();

try {
  const before = await migrator.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    return transaction`SELECT to_regclass('public.tenants')::text AS tenants_table`;
  });
  if (liveRequired) {
    assert(
      before[0].tenants_table === null,
      'Required live test database was not empty before migration',
    );
  }

  await migrate(migrationUrl);

  const migrationState = await migrator.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    return transaction`SELECT name FROM public._orvex_migrations ORDER BY name`;
  });
  assert(
    JSON.stringify(migrationState.map((migration) => migration.name)) ===
      JSON.stringify(expectedMigrationNames),
    'An empty database did not receive the exact migration set',
  );

  const roles = await runtime`
    SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication,
           rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('orvex_owner', 'orvex_migrator', 'orvex_runtime')
    ORDER BY rolname
  `;
  assert(roles.length === 3, 'Expected all three Orvex database roles');
  for (const role of roles) {
    assert(!role.rolsuper, `${role.rolname} must not be a superuser`);
    assert(!role.rolcreaterole, `${role.rolname} must not create roles`);
    assert(!role.rolcreatedb, `${role.rolname} must not create databases`);
    assert(!role.rolreplication, `${role.rolname} must not replicate`);
    assert(!role.rolbypassrls, `${role.rolname} must not bypass RLS`);
  }
  assert(
    !roles.find((role) => role.rolname === 'orvex_owner').rolcanlogin,
    'Owner must be NOLOGIN',
  );
  assert(
    roles.find((role) => role.rolname === 'orvex_migrator').rolcanlogin,
    'Migrator must login',
  );
  assert(roles.find((role) => role.rolname === 'orvex_runtime').rolcanlogin, 'Runtime must login');
  assert(
    !roles.find((role) => role.rolname === 'orvex_migrator').rolinherit &&
      !roles.find((role) => role.rolname === 'orvex_runtime').rolinherit,
    'Migrator and runtime login roles must be NOINHERIT',
  );

  const runtimeMembership = await runtime`
    SELECT pg_has_role(current_user, 'orvex_owner', 'MEMBER') AS owns_membership
  `;
  assert(!runtimeMembership[0].owns_membership, 'Runtime must not be a member of the owner role');
  await expectRejected(
    () =>
      runtime.begin(async (transaction) => {
        await transaction.unsafe('SET LOCAL ROLE orvex_owner');
      }),
    /permission denied to set role/i,
    'Runtime owner-role assumption',
  );

  const ownerMemberships = await runtime`
    SELECT member_role.rolname AS member_name, membership.admin_option,
           membership.inherit_option, membership.set_option
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE granted_role.rolname = 'orvex_owner'
    ORDER BY member_role.rolname
  `;
  assert(
    ownerMemberships.length === 1 &&
      ownerMemberships[0].member_name === 'orvex_migrator' &&
      !ownerMemberships[0].admin_option &&
      !ownerMemberships[0].inherit_option &&
      ownerMemberships[0].set_option,
    'Owner membership must be SET-only for the NOINHERIT migrator',
  );

  const tableOwners = await runtime`
    SELECT relation.relname AS relation_name, owner.rolname AS owner
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles owner ON owner.oid = relation.relowner
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
    ORDER BY relation.relname
  `;
  assert(tableOwners.length > 0, 'Expected application tables in the migrated schema');
  for (const table of tableOwners) {
    const expectedOwner =
      table.relation_name === 'finance_audit_outbox'
        ? 'orvex_finance_audit_relay_owner'
        : 'orvex_owner';
    assert(
      table.owner === expectedOwner,
      `${table.relation_name} must be owned by ${expectedOwner}`,
    );
  }

  const tenantScopedTables = await runtime`
    SELECT relation.relname AS relation_name, relation.relrowsecurity AS row_security,
           relation.relforcerowsecurity AS force_row_security,
           count(policy.policyname)::int AS policy_count,
           bool_or(
             policy.cmd = 'ALL'
             AND 'public' = ANY(policy.roles)
             AND policy.qual IS NOT NULL
             AND policy.with_check IS NOT NULL
           ) AS has_complete_public_policy,
           has_table_privilege(
             'orvex_runtime', format('%I.%I', namespace.nspname, relation.relname),
             'SELECT,INSERT,UPDATE,DELETE'
           ) AS tenant_runtime_has_dml
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = 'tenant_id'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    LEFT JOIN pg_policies policy
      ON policy.schemaname = namespace.nspname AND policy.tablename = relation.relname
    WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
    GROUP BY namespace.nspname, relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
    ORDER BY relation.relname
  `;
  assert(tenantScopedTables.length > 0, 'Expected tenant-scoped tables in the migrated schema');
  for (const table of tenantScopedTables) {
    if (!table.row_security) {
      assert(
        !table.tenant_runtime_has_dml,
        `${table.relation_name} without forced RLS must remain inaccessible to the tenant runtime role`,
      );
      continue;
    }
    if (!table.force_row_security) {
      if (ownerMediatedRlsTables.has(table.relation_name)) {
        assert(table.policy_count > 0, `${table.relation_name} must define an RLS policy`);
        continue;
      }
      assert(
        !table.tenant_runtime_has_dml,
        `${table.relation_name} without forced RLS must remain inaccessible to the tenant runtime role`,
      );
      continue;
    }
    assert(table.policy_count > 0, `${table.relation_name} must define an RLS policy`);
    assert(
      table.has_complete_public_policy,
      `${table.relation_name} must apply tenant filtering and write checks to every command`,
    );
  }

  await migrator.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL ROLE orvex_owner');
    await transaction`
      INSERT INTO tenants (id, code, brand_name, legal_name)
      VALUES (${tenantA}, ${`a-${tenantA}`}, 'Tenant A', 'Tenant A SAL'),
             (${tenantB}, ${`b-${tenantB}`}, 'Tenant B', 'Tenant B SAL')
    `;
    await transaction`
      INSERT INTO users (id, account_kind, email, display_name, password_hash)
      VALUES (${userA}, 'tenant', ${`${userA}@example.test`}, 'User A', 'not-a-real-hash'),
             (${userB}, 'tenant', ${`${userB}@example.test`}, 'User B', 'not-a-real-hash'),
             (${supportRequester}, 'platform', ${`${supportRequester}@example.test`}, 'Support Requester', 'not-a-real-hash'),
             (${supportApprover}, 'platform', ${`${supportApprover}@example.test`}, 'Support Approver', 'not-a-real-hash')
    `;
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    await transaction`
      INSERT INTO tenant_memberships (tenant_id, user_id, role_key)
      VALUES (${tenantA}, ${userA}, 'owner')
    `;
    await transaction`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
    await transaction`
      INSERT INTO tenant_memberships (tenant_id, user_id, role_key)
      VALUES (${tenantB}, ${userB}, 'owner')
    `;
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    await transaction`
      INSERT INTO support_grants (
        id, tenant_id, ticket_id, requester_id, approver_id, reason, permissions, status, expires_at
      ) VALUES (
        ${supportGrant}, ${tenantA}, 'TEST-1', ${supportRequester}, ${supportApprover},
        'Validate live support scope', ARRAY['tenant.dashboard.view'], 'approved', now() + interval '15 minutes'
      )
    `;
  });

  const tenantASelect = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`SELECT tenant_id::text FROM tenant_memberships ORDER BY tenant_id`;
  });
  assert(
    tenantASelect.length === 1 && tenantASelect[0].tenant_id === tenantA,
    'RLS SELECT exposed another tenant',
  );

  const missingContext = await runtime`SELECT tenant_id FROM tenant_memberships`;
  assert(missingContext.length === 0, 'A missing tenant context must return no tenant rows');

  const approvedGrant = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      SELECT id, authorization_version::int
      FROM support_grants
      WHERE id = ${supportGrant}
        AND tenant_id = ${tenantA}
        AND requester_id = ${supportRequester}
        AND approver_id IS NOT NULL
        AND status = 'approved'
        AND revoked_at IS NULL
        AND expires_at > now()
    `;
  });
  assert(
    approvedGrant.length === 1 && approvedGrant[0].authorization_version === 1,
    'An approved in-scope support grant was not readable canonically',
  );

  const crossTenantGrant = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
    return transaction`SELECT id FROM support_grants WHERE id = ${supportGrant}`;
  });
  assert(crossTenantGrant.length === 0, 'Support grant RLS exposed another tenant grant');

  await expectRejected(
    () =>
      runtime.begin(async (transaction) => {
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          INSERT INTO support_grants (
            tenant_id, ticket_id, requester_id, reason, permissions, expires_at
          ) VALUES (
            ${tenantA}, 'TEST-EMPTY', ${supportRequester}, 'Reject an empty permission scope',
            ARRAY[]::text[], now() + interval '15 minutes'
          )
        `;
      }),
    /support_grants_permissions_nonempty_check|check constraint/i,
    'Empty support permission scope',
  );

  await expectRejected(
    () =>
      runtime.begin(async (transaction) => {
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          INSERT INTO support_grants (
            tenant_id, ticket_id, requester_id, reason, permissions, status, expires_at
          ) VALUES (
            ${tenantA}, 'TEST-NO-APPROVER', ${supportRequester}, 'Reject approval without an approver',
            ARRAY['tenant.dashboard.view'], 'approved', now() + interval '15 minutes'
          )
        `;
      }),
    /support_grants_approval_state_check|check constraint/i,
    'Approved support grant without approver',
  );

  const revokedGrant = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      UPDATE support_grants
      SET status = 'revoked', revoked_at = now()
      WHERE id = ${supportGrant}
      RETURNING authorization_version::int
    `;
  });
  assert(
    revokedGrant.length === 1 && revokedGrant[0].authorization_version === 2,
    'Revoking a support grant did not invalidate its authorization version',
  );

  const activeAfterRevocation = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      SELECT id FROM support_grants
      WHERE id = ${supportGrant} AND status = 'approved' AND revoked_at IS NULL AND expires_at > now()
    `;
  });
  assert(activeAfterRevocation.length === 0, 'A revoked support grant remained active');

  await expectRejected(
    () => runtime`INSERT INTO tenant_dashboard_snapshots (tenant_id) VALUES (${tenantA})`,
    /row-level security/i,
    'Missing-context INSERT',
  );

  await expectRejected(
    () =>
      runtime.begin(async (transaction) => {
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`INSERT INTO tenant_dashboard_snapshots (tenant_id) VALUES (${tenantB})`;
      }),
    /row-level security/i,
    'Cross-tenant INSERT',
  );

  const ownSnapshot = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      INSERT INTO tenant_dashboard_snapshots (tenant_id) VALUES (${tenantA}) RETURNING id
    `;
  });
  assert(ownSnapshot.length === 1, 'Same-tenant INSERT should succeed');

  await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
    await transaction`
      INSERT INTO tenant_dashboard_snapshots (tenant_id, active_subscribers)
      VALUES (${tenantB}, 900)
    `;
  });

  const importedSnapshots = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      WITH incoming (tenant_id, active_subscribers) AS (
        VALUES (${tenantA}::uuid, 2::bigint), (${tenantA}::uuid, 3::bigint)
      )
      INSERT INTO tenant_dashboard_snapshots (tenant_id, active_subscribers)
      SELECT tenant_id, active_subscribers FROM incoming
      RETURNING tenant_id::text
    `;
  });
  assert(
    importedSnapshots.length === 2 && importedSnapshots.every((row) => row.tenant_id === tenantA),
    'Same-tenant batch import did not remain tenant-scoped',
  );

  await expectRejected(
    () =>
      runtime.begin(async (transaction) => {
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          WITH incoming (tenant_id, active_subscribers) AS (
            VALUES (${tenantA}::uuid, 4::bigint), (${tenantB}::uuid, 5::bigint)
          )
          INSERT INTO tenant_dashboard_snapshots (tenant_id, active_subscribers)
          SELECT tenant_id, active_subscribers FROM incoming
        `;
      }),
    /row-level security/i,
    'Mixed-tenant batch import',
  );

  const aggregateExport = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      SELECT snapshots.tenant_id::text AS tenant_id,
             count(DISTINCT snapshots.id)::int AS snapshot_count,
             count(DISTINCT memberships.user_id)::int AS member_count,
             sum(snapshots.active_subscribers)::int AS active_subscribers,
             jsonb_agg(DISTINCT jsonb_build_object(
               'snapshotId', snapshots.id,
               'activeSubscribers', snapshots.active_subscribers
             )) AS export_rows
      FROM tenant_dashboard_snapshots snapshots
      JOIN tenant_memberships memberships ON memberships.tenant_id = snapshots.tenant_id
      WHERE EXISTS (
        SELECT 1 FROM support_grants grants WHERE grants.tenant_id = snapshots.tenant_id
      )
      GROUP BY snapshots.tenant_id
    `;
  });
  assert(
    aggregateExport.length === 1 &&
      aggregateExport[0].tenant_id === tenantA &&
      aggregateExport[0].snapshot_count === 3 &&
      aggregateExport[0].member_count === 1 &&
      aggregateExport[0].active_subscribers === 5 &&
      aggregateExport[0].export_rows.length === 3,
    'Join/subquery/aggregate export crossed tenant scope or returned an invalid aggregate',
  );

  const bulkUpdate = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      UPDATE tenant_dashboard_snapshots
      SET online_subscribers = active_subscribers
      RETURNING tenant_id::text
    `;
  });
  assert(
    bulkUpdate.length === 3 && bulkUpdate.every((row) => row.tenant_id === tenantA),
    'Bulk UPDATE escaped the active tenant scope',
  );

  const ownUpsert = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      INSERT INTO tenant_memberships (tenant_id, user_id, role_key, permissions)
      VALUES (${tenantA}, ${userA}, 'owner', ARRAY['billing.read'])
      ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET permissions = EXCLUDED.permissions
      RETURNING tenant_id::text, permissions
    `;
  });
  assert(
    ownUpsert.length === 1 &&
      ownUpsert[0].tenant_id === tenantA &&
      ownUpsert[0].permissions.includes('billing.read'),
    'Same-tenant UPSERT did not update the scoped row',
  );

  await expectRejected(
    () =>
      runtime.begin(async (transaction) => {
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          INSERT INTO tenant_memberships (tenant_id, user_id, role_key)
          VALUES (${tenantB}, ${userB}, 'owner')
          ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_key = EXCLUDED.role_key
        `;
      }),
    /row-level security/i,
    'Cross-tenant UPSERT',
  );

  const crossUpdate = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
    return transaction`
      UPDATE tenant_dashboard_snapshots SET active_subscribers = 1
      WHERE id = ${ownSnapshot[0].id} RETURNING id
    `;
  });
  assert(crossUpdate.length === 0, 'Cross-tenant UPDATE must not see its target');

  const ownUpdate = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      UPDATE tenant_dashboard_snapshots SET active_subscribers = 1
      WHERE id = ${ownSnapshot[0].id} RETURNING id
    `;
  });
  assert(ownUpdate.length === 1, 'Same-tenant UPDATE should succeed');

  const crossDelete = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantB}, true)`;
    return transaction`
      DELETE FROM tenant_dashboard_snapshots WHERE id = ${ownSnapshot[0].id} RETURNING id
    `;
  });
  assert(crossDelete.length === 0, 'Cross-tenant DELETE must not see its target');

  const ownDelete = await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    return transaction`
      DELETE FROM tenant_dashboard_snapshots WHERE id = ${ownSnapshot[0].id} RETURNING id
    `;
  });
  assert(ownDelete.length === 1, 'Same-tenant DELETE should succeed');

  await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    await transaction`
      INSERT INTO audit_events (tenant_id, action, resource_type, request_id, result)
      VALUES (${tenantA}, 'live-test', 'database', ${randomUUID()}, 'success')
    `;
  });

  for (const [description, statement] of [
    ['runtime audit UPDATE', "UPDATE audit_events SET result = 'changed'"],
    ['runtime audit DELETE', 'DELETE FROM audit_events'],
    ['runtime audit TRUNCATE', 'TRUNCATE audit_events'],
  ]) {
    await expectRejected(
      () =>
        runtime.begin(async (transaction) => {
          await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
          await transaction.unsafe(statement);
        }),
      /permission denied/i,
      description,
    );
  }

  await runtime`
    INSERT INTO security_events (action, reason, request_id, ip_address)
    VALUES ('live-security-test', 'denied', ${randomUUID()}, '127.0.0.1')
  `;

  for (const [description, statement] of [
    ['runtime security-event SELECT', 'SELECT * FROM security_events'],
    ['runtime security-event UPDATE', "UPDATE security_events SET reason = 'changed'"],
    ['runtime security-event DELETE', 'DELETE FROM security_events'],
    ['runtime security-event TRUNCATE', 'TRUNCATE security_events'],
  ]) {
    await expectRejected(() => runtime.unsafe(statement), /permission denied/i, description);
  }

  for (const [description, statement] of [
    ['owner audit UPDATE', "UPDATE audit_events SET result = 'changed'"],
    ['owner audit DELETE', 'DELETE FROM audit_events'],
    ['owner audit TRUNCATE', 'TRUNCATE audit_events'],
  ]) {
    await expectRejected(
      () =>
        migrator.begin(async (transaction) => {
          await transaction.unsafe('SET LOCAL ROLE orvex_owner');
          await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
          await transaction.unsafe(statement);
        }),
      /audit_events are append-only/i,
      description,
    );
  }

  await runtime.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
    const visible = await transaction`SELECT id FROM tenant_memberships`;
    assert(visible.length === 1, 'Pool leakage setup did not see the expected tenant row');
  });
  const afterTransaction = await runtime`
    SELECT current_setting('app.tenant_id', true) AS tenant_context,
           (SELECT count(*)::int FROM tenant_memberships) AS visible_rows
  `;
  assert(
    (afterTransaction[0].tenant_context === '' || afterTransaction[0].tenant_context === null) &&
      afterTransaction[0].visible_rows === 0,
    'Transaction-local tenant context leaked through the one-connection pool',
  );

  await verifyPriorSchemaUpgrade();

  console.log(
    `Live PostgreSQL safety tests passed (${before[0].tenants_table === null ? 'empty migration verified' : 'existing migration verified'}).`,
  );
} finally {
  await Promise.all([migrator.end({ timeout: 5 }), runtime.end({ timeout: 5 })]);
}

async function verifyPriorSchemaUpgrade() {
  const upgradeInputs = [
    upgradeBootstrapUrl,
    upgradeMigrationUrl,
    upgradeRuntimeUrl,
    upgradeLegacyOwner,
    upgradeDatabaseName,
  ];
  if (upgradeInputs.some(Boolean) && upgradeInputs.some((value) => !value)) {
    throw new Error('Every DATABASE_UPGRADE_* input is required when prior-schema testing is set');
  }
  if (
    !upgradeBootstrapUrl ||
    !upgradeMigrationUrl ||
    !upgradeRuntimeUrl ||
    !upgradeLegacyOwner ||
    !upgradeDatabaseName
  ) {
    if (liveRequired) {
      throw new Error('Required live tests must provide the DATABASE_UPGRADE_* inputs');
    }
    console.log('Prior-schema upgrade test skipped: missing DATABASE_UPGRADE_* inputs');
    return;
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(upgradeLegacyOwner)) {
    throw new Error('DATABASE_UPGRADE_LEGACY_OWNER is not a safe PostgreSQL identifier');
  }

  const bootstrap = postgres(upgradeBootstrapUrl, { max: 1, prepare: false });
  const upgradeRuntime = postgres(upgradeRuntimeUrl, { max: 1, prepare: false });
  try {
    const baselinePath = fileURLToPath(
      new URL('../migrations/0000_identity_tenancy_audit.sql', import.meta.url),
    );
    const baseline = await readFile(baselinePath, 'utf8');
    await bootstrap.unsafe(baseline);

    const [legacyOwnership] = await bootstrap`
      SELECT owner.rolname AS owner
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles owner ON owner.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'support_grants'
    `;
    assert(
      legacyOwnership?.owner === upgradeLegacyOwner,
      'Prior-schema fixture was not owned by the legacy bootstrap role',
    );

    await bootstrap`ALTER TABLE public.tenant_dashboard_snapshots ADD COLUMN adoption_drift_probe text`;
    await expectRejected(
      () =>
        adoptLegacyBaseline({
          databaseUrl: upgradeBootstrapUrl,
          databaseName: upgradeDatabaseName,
          legacyOwner: upgradeLegacyOwner,
        }),
      /Legacy schema columns do not match/i,
      'Legacy adoption with catalog drift',
    );
    const rejectedAdoptionState = await bootstrap`
      SELECT to_regclass('public._orvex_migrations') IS NULL AS ledger_absent,
             pg_get_userbyid(relation.relowner) AS table_owner
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'tenant_dashboard_snapshots'
    `;
    assert(
      rejectedAdoptionState[0]?.ledger_absent &&
        rejectedAdoptionState[0]?.table_owner === upgradeLegacyOwner,
      'Rejected legacy adoption changed the ledger or object ownership',
    );
    await bootstrap`ALTER TABLE public.tenant_dashboard_snapshots DROP COLUMN adoption_drift_probe`;

    await adoptLegacyBaseline({
      databaseUrl: upgradeBootstrapUrl,
      databaseName: upgradeDatabaseName,
      legacyOwner: upgradeLegacyOwner,
    });
    await migrate(upgradeMigrationUrl);

    const upgraded = await upgradeRuntime`
      SELECT
        to_regclass('public.security_events') IS NOT NULL AS security_events_ready,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'support_grants'
            AND column_name = 'authorization_version'
        ) AS support_version_ready,
        ARRAY(
          SELECT name FROM public._orvex_migrations ORDER BY name
        ) AS migration_names
    `;
    assert(
      upgraded[0].security_events_ready &&
        upgraded[0].support_version_ready &&
        JSON.stringify(upgraded[0].migration_names) === JSON.stringify(expectedMigrationNames),
      'Prior schema did not upgrade through every forward migration',
    );
  } finally {
    await Promise.all([bootstrap.end({ timeout: 5 }), upgradeRuntime.end({ timeout: 5 })]);
  }
}
