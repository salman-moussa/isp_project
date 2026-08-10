import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { assertExactCatalogManifest, normalizeCatalogRows } from './legacy-baseline-manifest.mjs';

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
      await transaction.unsafe('SET LOCAL search_path TO pg_catalog');
      await verifyTargetIdentity(transaction, databaseName, legacyOwner);
      await verifyExactBaselineManifest(transaction, baseline);

      const [invalidGrants] = await transaction`
        SELECT count(*)::int AS count FROM public.support_grants
        WHERE pg_catalog.cardinality(permissions) = 0
           OR (status = 'approved' AND approver_id IS NULL)
      `;
      if (invalidGrants?.count !== 0) {
        throw new Error(
          'Legacy support grants require remediation before adoption: empty scope or missing approver',
        );
      }

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

async function verifyExactBaselineManifest(transaction, baseline) {
  const referenceSchema = `orvex_adoption_reference_${randomUUID().replaceAll('-', '')}`;
  await transaction.unsafe(`CREATE SCHEMA "${referenceSchema}"`);
  await transaction.unsafe(`SET LOCAL search_path TO "${referenceSchema}", pg_catalog`);
  await transaction.unsafe(baseline);
  await transaction.unsafe('SET LOCAL search_path TO pg_catalog');

  const [actual, reference] = await Promise.all([
    readCatalogManifest(transaction, 'public'),
    readCatalogManifest(transaction, referenceSchema),
  ]);
  assertExactCatalogManifest(actual, reference);

  const [ledgerState] = await transaction`
    SELECT pg_catalog.to_regclass('public._orvex_migrations') IS NOT NULL AS exists
  `;
  if (ledgerState?.exists) {
    throw new Error('Legacy adoption refuses a pre-existing _orvex_migrations ledger');
  }

  await Promise.all([
    createMigrationLedger(transaction, 'public'),
    createMigrationLedger(transaction, referenceSchema),
  ]);
  const [actualLedger, referenceLedger] = await Promise.all([
    readLedgerManifest(transaction, 'public'),
    readLedgerManifest(transaction, referenceSchema),
  ]);
  assertExactCatalogManifest(actualLedger, referenceLedger);

  await transaction.unsafe(`DROP SCHEMA "${referenceSchema}" CASCADE`);
}

async function createMigrationLedger(transaction, schemaName) {
  await transaction.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schemaName}"._orvex_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readCatalogManifest(transaction, schemaName) {
  const [
    relations,
    columns,
    constraints,
    indexes,
    types,
    enums,
    policies,
    functions,
    triggers,
    rules,
    inheritance,
    operators,
    casts,
    collations,
    operatorClasses,
    operatorFamilies,
  ] = await Promise.all([
    transaction`
        SELECT relation.relname AS relation_name, relation.relkind AS kind,
               relation.relpersistence AS persistence, relation.relrowsecurity AS row_security,
               relation.relforcerowsecurity AS force_row_security,
               relation.relreplident AS replica_identity, relation.relacl::text AS privileges
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ${schemaName}
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
          AND relation.relname <> '_orvex_migrations'
        ORDER BY relation.relname
      `,
    transaction`
        SELECT relation.relname AS relation_name, attribute.attnum::int AS ordinal_position,
               attribute.attname AS column_name,
               format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
               attribute.attnotnull AS not_null, attribute.attidentity AS identity_kind,
               attribute.attgenerated AS generated_kind, attribute.attstorage AS storage,
               attribute.attcompression AS compression,
               COALESCE(collation.collname, '') AS collation,
               attribute.attacl::text AS privileges,
               COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
        FROM pg_attribute attribute
        JOIN pg_class relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_attrdef default_value
          ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
        LEFT JOIN pg_collation collation ON collation.oid = attribute.attcollation
        WHERE namespace.nspname = ${schemaName}
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND relation.relname <> '_orvex_migrations'
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ORDER BY relation.relname, attribute.attnum
      `,
    transaction`
        SELECT relation.relname AS relation_name, constraint_row.conname AS constraint_name,
               constraint_row.contype AS kind, constraint_row.condeferrable AS deferrable,
               constraint_row.condeferred AS initially_deferred,
               constraint_row.convalidated AS validated,
               constraint_row.confupdtype AS foreign_update_action,
               constraint_row.confdeltype AS foreign_delete_action,
               constraint_row.confmatchtype AS foreign_match_type,
               constraint_row.conislocal AS is_local,
               constraint_row.coninhcount::int AS inheritance_count,
               constraint_row.connoinherit AS no_inherit,
               pg_get_constraintdef(constraint_row.oid, true) AS definition
        FROM pg_constraint constraint_row
        JOIN pg_class relation ON relation.oid = constraint_row.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ${schemaName}
          AND relation.relname <> '_orvex_migrations'
        ORDER BY relation.relname, constraint_row.conname
      `,
    transaction`
        SELECT table_relation.relname AS relation_name,
               index_relation.relname AS index_name,
               index_row.indisunique AS unique_index,
               index_row.indisprimary AS primary_index,
               index_row.indisexclusion AS exclusion_index,
               index_row.indimmediate AS immediate,
               index_row.indisclustered AS clustered,
               index_row.indisvalid AS valid,
               index_row.indcheckxmin AS check_xmin,
               index_row.indisready AS ready,
               index_row.indislive AS live,
               index_row.indisreplident AS replica_identity,
               index_row.indnullsnotdistinct AS nulls_not_distinct,
               pg_get_indexdef(index_relation.oid) AS definition,
               COALESCE(pg_get_expr(index_row.indpred, index_row.indrelid), '') AS predicate
        FROM pg_index index_row
        JOIN pg_class table_relation ON table_relation.oid = index_row.indrelid
        JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
        JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
        WHERE namespace.nspname = ${schemaName}
          AND table_relation.relname <> '_orvex_migrations'
        ORDER BY table_relation.relname, index_relation.relname
      `,
    transaction`
        SELECT type_row.typname AS type_name, type_row.typtype AS kind,
               type_row.typcategory AS category, type_row.typispreferred AS preferred,
               type_row.typnotnull AS not_null, type_row.typdelim AS delimiter,
               type_row.typalign AS alignment, type_row.typstorage AS storage,
               type_row.typbyval AS by_value, type_row.typlen::int AS length,
               COALESCE(type_row.typdefault, '') AS default_expression,
               type_row.typacl::text AS privileges
        FROM pg_type type_row
        JOIN pg_namespace namespace ON namespace.oid = type_row.typnamespace
        WHERE namespace.nspname = ${schemaName}
          AND type_row.typname NOT IN ('_orvex_migrations', '__orvex_migrations')
        ORDER BY type_row.typname
      `,
    transaction`
        SELECT type_row.typname AS type_name,
               array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder) AS labels
        FROM pg_type type_row
        JOIN pg_namespace namespace ON namespace.oid = type_row.typnamespace
        JOIN pg_enum enum_value ON enum_value.enumtypid = type_row.oid
        WHERE namespace.nspname = ${schemaName}
        GROUP BY type_row.typname ORDER BY type_row.typname
      `,
    transaction`
        SELECT tablename AS relation_name, policyname AS policy_name, permissive,
               roles::text AS roles, cmd AS command, qual AS using_expression,
               with_check AS check_expression
        FROM pg_policies WHERE schemaname = ${schemaName}
        ORDER BY tablename, policyname
      `,
    transaction`
        SELECT procedure_row.proname AS function_name, procedure_row.prokind AS kind,
               language.lanname AS language,
               pg_get_function_result(procedure_row.oid) AS result_type,
               pg_get_function_identity_arguments(procedure_row.oid) AS arguments,
               procedure_row.prosecdef AS security_definer,
               procedure_row.proleakproof AS leakproof, procedure_row.proisstrict AS strict,
               procedure_row.proretset AS returns_set,
               procedure_row.provolatile AS volatility, procedure_row.proparallel AS parallel,
               procedure_row.procost::text AS cost, procedure_row.prorows::text AS rows,
               procedure_row.proconfig::text AS configuration,
               procedure_row.proacl::text AS privileges, procedure_row.prosrc AS body
        FROM pg_proc procedure_row
        JOIN pg_namespace namespace ON namespace.oid = procedure_row.pronamespace
        JOIN pg_language language ON language.oid = procedure_row.prolang
        WHERE namespace.nspname = ${schemaName}
        ORDER BY procedure_row.proname, pg_get_function_identity_arguments(procedure_row.oid)
      `,
    transaction`
        SELECT relation.relname AS relation_name, trigger_row.tgname AS trigger_name,
               procedure_row.proname AS function_name, trigger_row.tgenabled AS enabled,
               trigger_row.tgtype::int AS trigger_type, trigger_row.tgnargs::int AS argument_count,
               trigger_row.tgattr::text AS update_columns,
               encode(trigger_row.tgargs, 'hex') AS arguments,
               COALESCE(pg_get_expr(trigger_row.tgqual, trigger_row.tgrelid), '') AS condition,
               pg_get_triggerdef(trigger_row.oid, true) AS definition
        FROM pg_trigger trigger_row
        JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        JOIN pg_proc procedure_row ON procedure_row.oid = trigger_row.tgfoid
        WHERE namespace.nspname = ${schemaName} AND NOT trigger_row.tgisinternal
        ORDER BY relation.relname, trigger_row.tgname
      `,
    transaction`
        SELECT relation.relname AS relation_name, rule_row.rulename AS rule_name,
               rule_row.ev_type AS event_type, rule_row.ev_enabled AS enabled,
               rule_row.is_instead AS instead,
               pg_get_ruledef(rule_row.oid, true) AS definition
        FROM pg_rewrite rule_row
        JOIN pg_class relation ON relation.oid = rule_row.ev_class
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = ${schemaName}
          AND relation.relname <> '_orvex_migrations'
        ORDER BY relation.relname, rule_row.rulename
      `,
    transaction`
        SELECT child.relname AS child_relation, parent_namespace.nspname AS parent_schema,
               parent.relname AS parent_relation, inheritance.inhseqno::int AS sequence
        FROM pg_inherits inheritance
        JOIN pg_class child ON child.oid = inheritance.inhrelid
        JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = inheritance.inhparent
        JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
        WHERE child_namespace.nspname = ${schemaName}
        ORDER BY child.relname, inheritance.inhseqno
      `,
    transaction`
        SELECT operator_row.oprname AS operator_name, operator_row.oprkind AS kind,
               operator_row.oprcanmerge AS can_merge, operator_row.oprcanhash AS can_hash,
               format_type(operator_row.oprleft, NULL) AS left_type,
               format_type(operator_row.oprright, NULL) AS right_type,
               format_type(operator_row.oprresult, NULL) AS result_type,
               operator_row.oprcode::regprocedure::text AS implementation,
               operator_row.oprrest::regprocedure::text AS restriction,
               operator_row.oprjoin::regprocedure::text AS join_estimator
        FROM pg_operator operator_row
        JOIN pg_namespace namespace ON namespace.oid = operator_row.oprnamespace
        WHERE namespace.nspname = ${schemaName}
        ORDER BY operator_row.oprname, operator_row.oprleft, operator_row.oprright
      `,
    transaction`
        SELECT format_type(cast_row.castsource, NULL) AS source_type,
               format_type(cast_row.casttarget, NULL) AS target_type,
               cast_row.castcontext AS context, cast_row.castmethod AS method,
               cast_row.castfunc::regprocedure::text AS implementation
        FROM pg_cast cast_row
        JOIN pg_type source_type ON source_type.oid = cast_row.castsource
        JOIN pg_namespace source_namespace ON source_namespace.oid = source_type.typnamespace
        JOIN pg_type target_type ON target_type.oid = cast_row.casttarget
        JOIN pg_namespace target_namespace ON target_namespace.oid = target_type.typnamespace
        WHERE source_namespace.nspname = ${schemaName}
           OR target_namespace.nspname = ${schemaName}
        ORDER BY source_type.typname, target_type.typname
      `,
    transaction`
        SELECT collation.collname AS collation_name, collation.collprovider AS provider,
               collation.collisdeterministic AS deterministic,
               collation.collencoding::int AS encoding, collation.collcollate AS collate,
               collation.collctype AS character_type
        FROM pg_collation collation
        JOIN pg_namespace namespace ON namespace.oid = collation.collnamespace
        WHERE namespace.nspname = ${schemaName}
        ORDER BY collation.collname
      `,
    transaction`
        SELECT operator_class.opcname AS class_name, access_method.amname AS access_method,
               format_type(operator_class.opcintype, NULL) AS input_type,
               operator_class.opcdefault AS is_default
        FROM pg_opclass operator_class
        JOIN pg_namespace namespace ON namespace.oid = operator_class.opcnamespace
        JOIN pg_am access_method ON access_method.oid = operator_class.opcmethod
        WHERE namespace.nspname = ${schemaName}
        ORDER BY operator_class.opcname, access_method.amname
      `,
    transaction`
        SELECT operator_family.opfname AS family_name, access_method.amname AS access_method
        FROM pg_opfamily operator_family
        JOIN pg_namespace namespace ON namespace.oid = operator_family.opfnamespace
        JOIN pg_am access_method ON access_method.oid = operator_family.opfmethod
        WHERE namespace.nspname = ${schemaName}
        ORDER BY operator_family.opfname, access_method.amname
      `,
  ]);

  return {
    relations,
    columns: normalizeCatalogRows(columns, schemaName, ['data_type', 'default_expression']),
    constraints: normalizeCatalogRows(constraints, schemaName, ['definition']),
    indexes: normalizeCatalogRows(indexes, schemaName, ['definition', 'predicate']),
    types: normalizeCatalogRows(types, schemaName, ['default_expression']),
    enums,
    policies: normalizeCatalogRows(policies, schemaName, ['using_expression', 'check_expression']),
    functions: normalizeCatalogRows(functions, schemaName, ['result_type', 'body']),
    triggers: normalizeCatalogRows(triggers, schemaName, ['condition', 'definition']),
    rules: normalizeCatalogRows(rules, schemaName, ['definition']),
    inheritance: normalizeCatalogRows(inheritance, schemaName, ['parent_schema']),
    operators: normalizeCatalogRows(operators, schemaName, [
      'left_type',
      'right_type',
      'result_type',
      'implementation',
      'restriction',
      'join_estimator',
    ]),
    casts: normalizeCatalogRows(casts, schemaName, [
      'source_type',
      'target_type',
      'implementation',
    ]),
    collations,
    operatorClasses: normalizeCatalogRows(operatorClasses, schemaName, ['input_type']),
    operatorFamilies,
  };
}

async function readLedgerManifest(transaction, schemaName) {
  const [relations, columns, constraints, indexes, types] = await Promise.all([
    transaction`
      SELECT relation.relname AS relation_name, relation.relkind AS kind,
             relation.relpersistence AS persistence, relation.relacl::text AS privileges
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${schemaName} AND relation.relname = '_orvex_migrations'
    `,
    transaction`
      SELECT attribute.attnum::int AS ordinal_position, attribute.attname AS column_name,
             format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
             attribute.attnotnull AS not_null, attribute.attidentity AS identity_kind,
             attribute.attgenerated AS generated_kind,
             attribute.attacl::text AS privileges,
             COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = ${schemaName} AND relation.relname = '_orvex_migrations'
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ORDER BY attribute.attnum
    `,
    transaction`
      SELECT constraint_row.conname AS constraint_name, constraint_row.contype AS kind,
             pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_constraint constraint_row
      JOIN pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${schemaName} AND relation.relname = '_orvex_migrations'
      ORDER BY constraint_row.conname
    `,
    transaction`
      SELECT index_relation.relname AS index_name,
             pg_get_indexdef(index_relation.oid) AS definition
      FROM pg_index index_row
      JOIN pg_class relation ON relation.oid = index_row.indrelid
      JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = ${schemaName} AND relation.relname = '_orvex_migrations'
      ORDER BY index_relation.relname
    `,
    transaction`
      SELECT type_row.typname AS type_name, type_row.typtype AS kind,
             type_row.typcategory AS category, type_row.typnotnull AS not_null
      FROM pg_type type_row JOIN pg_namespace namespace ON namespace.oid = type_row.typnamespace
      WHERE namespace.nspname = ${schemaName}
        AND type_row.typname IN ('_orvex_migrations', '__orvex_migrations')
      ORDER BY type_row.typname
    `,
  ]);
  return {
    relations,
    columns: normalizeCatalogRows(columns, schemaName, ['data_type', 'default_expression']),
    constraints: normalizeCatalogRows(constraints, schemaName, ['definition']),
    indexes: normalizeCatalogRows(indexes, schemaName, ['definition']),
    types,
  };
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
