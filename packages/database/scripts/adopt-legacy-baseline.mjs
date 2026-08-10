import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  assertExactSection,
  expectedColumns,
  expectedConstraints,
  expectedEnums,
  expectedFunction,
  expectedIndexes,
  expectedPolicies,
  expectedTables,
  expectedTrigger,
  normalizeDefault,
  normalizeSql,
} from './legacy-baseline-manifest.mjs';

const baselineName = '0000_identity_tenancy_audit.sql';
const baselineUrl = new URL(`../migrations/${baselineName}`, import.meta.url);

export async function adoptLegacyBaseline({ databaseUrl, databaseName, legacyOwner }) {
  for (const [label, value] of [
    ['ORVEX_DATABASE_NAME', databaseName],
    ['ORVEX_LEGACY_DB_OWNER', legacyOwner],
  ]) {
    if (!value || !/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(value)) {
      throw new Error(`${label} is not a safe PostgreSQL identifier`);
    }
  }
  if (!databaseUrl) throw new Error('DATABASE_BOOTSTRAP_URL is required');

  const baseline = await readFile(fileURLToPath(baselineUrl), 'utf8');
  const checksum = createHash('sha256').update(baseline).digest('hex');
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client.begin(async (transaction) => {
      await verifyTargetIdentity(transaction, databaseName, legacyOwner);
      await verifyExactBaselineManifest(transaction);

      const [invalidGrants] = await transaction`
        SELECT count(*)::int AS count FROM support_grants
        WHERE cardinality(permissions) = 0
           OR (status = 'approved' AND approver_id IS NULL)
      `;
      if (invalidGrants?.count !== 0) {
        throw new Error(
          'Legacy support grants require remediation before adoption: empty scope or missing approver',
        );
      }

      await transaction.unsafe(`
        CREATE TABLE IF NOT EXISTS public._orvex_migrations (
          name text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const [recorded] = await transaction`
        SELECT checksum FROM public._orvex_migrations WHERE name = ${baselineName}
      `;
      const unexpectedHistory = await transaction`
        SELECT name FROM public._orvex_migrations WHERE name <> ${baselineName}
      `;
      if (unexpectedHistory.length > 0) {
        throw new Error('Legacy adoption only accepts an unadvanced baseline migration ledger');
      }
      if (recorded && recorded.checksum !== checksum) {
        throw new Error('Existing baseline migration checksum does not match the immutable file');
      }
      if (!recorded) {
        await transaction`
          INSERT INTO public._orvex_migrations (name, checksum) VALUES (${baselineName}, ${checksum})
        `;
      }

      for (const tableName of [
        '_orvex_migrations',
        'audit_events',
        'sessions',
        'support_grants',
        'tenant_dashboard_snapshots',
        'tenant_memberships',
        'tenants',
        'users',
      ]) {
        await transaction.unsafe(`ALTER TABLE public."${tableName}" OWNER TO orvex_owner`);
      }
      await transaction.unsafe('ALTER TYPE public.account_kind OWNER TO orvex_owner');
      await transaction.unsafe('ALTER TYPE public.support_grant_status OWNER TO orvex_owner');
      await transaction.unsafe(
        'ALTER FUNCTION public.reject_audit_mutation() OWNER TO orvex_owner',
      );
      await transaction.unsafe(`ALTER DATABASE "${databaseName}" OWNER TO orvex_owner`);
      await transaction.unsafe('ALTER SCHEMA public OWNER TO orvex_owner');
      await transaction.unsafe(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`);
      await transaction.unsafe(
        `GRANT CONNECT ON DATABASE "${databaseName}" TO orvex_migrator, orvex_runtime`,
      );
      await transaction.unsafe('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await transaction.unsafe('GRANT USAGE ON SCHEMA public TO orvex_runtime');
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function verifyTargetIdentity(transaction, databaseName, legacyOwner) {
  const [database] = await transaction`
    SELECT current_database() AS database_name,
           pg_get_userbyid(database_row.datdba) AS database_owner,
           pg_get_userbyid(namespace.nspowner) AS schema_owner
    FROM pg_database database_row
    JOIN pg_namespace namespace ON namespace.nspname = 'public'
    WHERE database_row.datname = current_database()
  `;
  if (database?.database_name !== databaseName) {
    throw new Error('DATABASE_BOOTSTRAP_URL does not target ORVEX_DATABASE_NAME');
  }

  const objectOwners = await transaction`
    SELECT DISTINCT owner FROM (
      SELECT pg_get_userbyid(relation.relowner) AS owner
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
        AND relation.relname IN (
          'tenants', 'users', 'tenant_memberships', 'sessions', 'support_grants',
          'audit_events', 'tenant_dashboard_snapshots'
        )
      UNION ALL
      SELECT pg_get_userbyid(type_row.typowner) AS owner
      FROM pg_type type_row JOIN pg_namespace namespace ON namespace.oid = type_row.typnamespace
      WHERE namespace.nspname = 'public'
        AND type_row.typname IN ('account_kind', 'support_grant_status')
      UNION ALL
      SELECT pg_get_userbyid(procedure_row.proowner) AS owner
      FROM pg_proc procedure_row
      JOIN pg_namespace namespace ON namespace.oid = procedure_row.pronamespace
      WHERE namespace.nspname = 'public' AND procedure_row.proname = 'reject_audit_mutation'
    ) owners ORDER BY owner
  `;
  const allowedOwner = objectOwners.length === 1 ? objectOwners[0].owner : undefined;
  if (
    !allowedOwner ||
    ![legacyOwner, 'orvex_owner'].includes(allowedOwner) ||
    database.database_owner !== allowedOwner ||
    ![allowedOwner, 'pg_database_owner'].includes(database.schema_owner)
  ) {
    throw new Error('Legacy baseline objects do not have one expected owner');
  }
}

async function verifyExactBaselineManifest(transaction) {
  const tables = await transaction`
    SELECT relation.relname AS table_name, relation.relpersistence AS persistence,
           relation.relrowsecurity AS row_security,
           relation.relforcerowsecurity AS force_row_security
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
      AND relation.relname <> '_orvex_migrations'
    ORDER BY relation.relname
  `;
  assertExactSection(
    'tables and RLS flags',
    tables.map((row) => ({
      tableName: row.table_name,
      persistence: row.persistence,
      rowSecurity: row.row_security,
      forceRowSecurity: row.force_row_security,
    })),
    expectedTables,
  );

  const columns = await transaction`
    SELECT relation.relname AS table_name, attribute.attnum::int AS ordinal_position,
           attribute.attname AS column_name,
           format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
           attribute.attnotnull AS not_null,
           COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
    FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
      AND relation.relname <> '_orvex_migrations'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ORDER BY relation.relname, attribute.attnum
  `;
  assertExactSection(
    'columns',
    columns.map((row) => ({
      tableName: row.table_name,
      ordinalPosition: row.ordinal_position,
      columnName: row.column_name,
      dataType: row.data_type,
      notNull: row.not_null,
      defaultExpression: normalizeDefault(row.default_expression),
    })),
    expectedColumns,
  );

  const constraints = await transaction`
    SELECT relation.relname AS table_name, constraint_row.conname AS constraint_name,
           constraint_row.contype AS kind,
           pg_get_constraintdef(constraint_row.oid, true) AS definition
    FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname <> '_orvex_migrations'
    ORDER BY relation.relname, constraint.conname
  `;
  assertExactSection(
    'constraints',
    constraints.map((row) => ({
      tableName: row.table_name,
      constraintName: row.constraint_name,
      kind: row.kind,
      definition: normalizeSql(row.definition),
    })),
    expectedConstraints,
  );

  const indexes = await transaction`
    SELECT table_relation.relname AS table_name, index_relation.relname AS index_name,
           pg_get_indexdef(index_relation.oid) AS definition
    FROM pg_index index_row
    JOIN pg_class table_relation ON table_relation.oid = index_row.indrelid
    JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'public' AND table_relation.relname <> '_orvex_migrations'
    ORDER BY table_relation.relname, index_relation.relname
  `;
  assertExactSection(
    'indexes',
    indexes.map((row) => ({
      tableName: row.table_name,
      indexName: row.index_name,
      definition: normalizeSql(row.definition),
    })),
    expectedIndexes,
  );

  const enums = await transaction`
    SELECT type_row.typname AS type_name,
           array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder) AS labels
    FROM pg_type type_row JOIN pg_namespace namespace ON namespace.oid = type_row.typnamespace
    JOIN pg_enum enum_value ON enum_value.enumtypid = type_row.oid
    WHERE namespace.nspname = 'public'
    GROUP BY type_row.typname ORDER BY type_row.typname
  `;
  assertExactSection(
    'enums',
    enums.map((row) => ({ typeName: row.type_name, labels: row.labels })),
    expectedEnums,
  );

  const policies = await transaction`
    SELECT tablename AS table_name, policyname AS policy_name, permissive,
           roles::text AS roles, cmd AS command, qual AS using_expression,
           with_check AS check_expression
    FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname
  `;
  assertExactSection(
    'RLS policies',
    policies.map((row) => ({
      tableName: row.table_name,
      policyName: row.policy_name,
      permissive: row.permissive,
      roles: row.roles,
      command: row.command,
      usingExpression: normalizeSql(row.using_expression),
      checkExpression: normalizeSql(row.check_expression),
    })),
    expectedPolicies,
  );

  const functions = await transaction`
    SELECT procedure_row.proname AS function_name, language.lanname AS language,
           pg_get_function_result(procedure_row.oid) AS result_type,
           pg_get_function_identity_arguments(procedure_row.oid) AS arguments,
           procedure_row.prosecdef AS security_definer,
           procedure_row.provolatile AS volatility, procedure_row.prosrc AS body
    FROM pg_proc procedure_row
    JOIN pg_namespace namespace ON namespace.oid = procedure_row.pronamespace
    JOIN pg_language language ON language.oid = procedure_row.prolang
    WHERE namespace.nspname = 'public' ORDER BY procedure_row.proname
  `;
  assertExactSection(
    'audit function',
    functions.map((row) => ({
      functionName: row.function_name,
      language: row.language,
      resultType: row.result_type,
      arguments: row.arguments,
      securityDefiner: row.security_definer,
      volatility: row.volatility,
      body: normalizeSql(row.body),
    })),
    [expectedFunction],
  );

  const triggers = await transaction`
    SELECT relation.relname AS table_name, trigger_row.tgname AS trigger_name,
           procedure_row.proname AS function_name, trigger_row.tgenabled AS enabled,
           trigger_row.tgtype::int AS trigger_type
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_proc procedure_row ON procedure_row.oid = trigger_row.tgfoid
    WHERE namespace.nspname = 'public' AND NOT trigger_row.tgisinternal
    ORDER BY relation.relname, trigger_row.tgname
  `;
  assertExactSection(
    'audit trigger',
    triggers.map((row) => ({
      tableName: row.table_name,
      triggerName: row.trigger_name,
      functionName: row.function_name,
      enabled: row.enabled,
      triggerType: row.trigger_type,
    })),
    [expectedTrigger],
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  adoptLegacyBaseline({
    databaseUrl: process.env.DATABASE_BOOTSTRAP_URL,
    databaseName: process.env.ORVEX_DATABASE_NAME,
    legacyOwner: process.env.ORVEX_LEGACY_DB_OWNER,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
