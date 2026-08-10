import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

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
      const [signature] = await transaction`
        SELECT
          (
            SELECT count(*)::int FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relname IN (
                'tenants', 'users', 'tenant_memberships', 'sessions', 'support_grants',
                'audit_events', 'tenant_dashboard_snapshots'
              )
              AND relation.relkind = 'r'
          ) AS table_count,
          (
            SELECT count(*)::int FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind = 'r'
              AND relation.relname <> '_orvex_migrations'
          ) AS public_table_count,
          (
            SELECT count(*)::int FROM pg_type type
            JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
            WHERE namespace.nspname = 'public'
              AND type.typname IN ('account_kind', 'support_grant_status')
          ) AS type_count,
          (
            SELECT count(*)::int FROM pg_type type
            JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
            WHERE namespace.nspname = 'public' AND type.typtype = 'e'
          ) AS public_enum_count,
          (
            SELECT count(*)::int FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relname IN (
                'tenant_memberships', 'support_grants', 'audit_events',
                'tenant_dashboard_snapshots'
              )
              AND relation.relrowsecurity AND relation.relforcerowsecurity
          ) AS forced_rls_count,
          (
            SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public'
              AND (tablename, policyname) IN (
                ('tenant_memberships', 'tenant_memberships_isolation'),
                ('support_grants', 'support_grants_isolation'),
                ('audit_events', 'audit_events_isolation'),
                ('tenant_dashboard_snapshots', 'tenant_dashboard_snapshots_isolation')
              )
          ) AS policy_count,
          (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS public_policy_count,
          (
            SELECT count(*)::int FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN (
                'tenants', 'users', 'tenant_memberships', 'sessions', 'support_grants',
                'audit_events', 'tenant_dashboard_snapshots'
              )
          ) AS column_count,
          (
            SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
            FROM pg_enum enum_value JOIN pg_type type ON type.oid = enum_value.enumtypid
            JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
            WHERE namespace.nspname = 'public' AND type.typname = 'account_kind'
          ) = ARRAY['platform', 'tenant'] AS account_kind_ready,
          (
            SELECT array_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
            FROM pg_enum enum_value JOIN pg_type type ON type.oid = enum_value.enumtypid
            JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
            WHERE namespace.nspname = 'public' AND type.typname = 'support_grant_status'
          ) = ARRAY['requested', 'approved', 'revoked', 'expired'] AS support_status_ready,
          EXISTS (
            SELECT 1 FROM pg_trigger trigger_row
            JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public' AND relation.relname = 'audit_events'
              AND trigger_row.tgname = 'audit_events_no_update_or_delete'
              AND NOT trigger_row.tgisinternal
          ) AND to_regprocedure('public.reject_audit_mutation()') IS NOT NULL AS audit_guard_ready
      `;
      if (
        signature?.table_count !== 7 ||
        signature.public_table_count !== 7 ||
        signature.type_count !== 2 ||
        signature.public_enum_count !== 2 ||
        signature.forced_rls_count !== 4 ||
        signature.policy_count !== 4 ||
        signature.public_policy_count !== 4 ||
        signature.column_count !== 70 ||
        !signature.account_kind_ready ||
        !signature.support_status_ready ||
        !signature.audit_guard_ready
      ) {
        throw new Error('Legacy schema does not match the immutable Orvex baseline signature');
      }

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

      await transaction.unsafe(`REASSIGN OWNED BY "${legacyOwner}" TO orvex_owner`);
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
