# Live PostgreSQL safety tests

These tests cover REQ-SEC-003 and REQ-SEC-006 against PostgreSQL itself. They do not replace the
fast migration-content test. The live harness proves that migrations apply to an empty database, the
application login is a non-owner `NOBYPASSRLS` role, tenant policies cover every DML path,
transaction-local context cannot leak through a reused connection, and audit rows cannot be updated,
deleted, or truncated even by the object owner.

## Role and connection contract

Local and test initialization creates four deliberately separate identities:

- `POSTGRES_USER` is the container bootstrap superuser. It is initialization-only.
- `orvex_owner` is the `NOLOGIN`, `NOBYPASSRLS` database/schema/object owner.
- `orvex_migrator` is a non-superuser login allowed to `SET ROLE orvex_owner` through the migration
  runner. It is not an application credential.
- `orvex_runtime` is a non-superuser, `NOBYPASSRLS`, non-owner login with explicit table grants.

Runtime and migrator login defaults put trusted `pg_catalog` before `public`. The controlled
migration transaction temporarily selects `public, pg_catalog` only after the database is fresh or
the exact legacy catalog has been verified and public creation rights have been removed.

Use distinct DSNs. `DATABASE_MIGRATION_URL` must authenticate as `orvex_migrator` and
`DATABASE_RUNTIME_URL` must authenticate as `orvex_runtime`. `DATABASE_URL` should be the runtime
DSN when an application still consumes that legacy variable. Never point any application process at
`POSTGRES_USER` or `DATABASE_MIGRATION_URL`.

For the fixed credentials in `docker-compose.test.yml`, discover the allocated port and run:

```sh
docker compose -f docker-compose.test.yml up -d --wait postgres-test
pg_port="$(docker compose -f docker-compose.test.yml port postgres-test 5432 | sed 's/.*://')"
export DATABASE_MIGRATION_URL="postgresql://orvex_migrator:test-only-migrator-not-production@127.0.0.1:${pg_port}/isp_test"
export DATABASE_RUNTIME_URL="postgresql://orvex_runtime:test-only-runtime-not-production@127.0.0.1:${pg_port}/isp_test"
export ORVEX_REQUIRE_LIVE_POSTGRES=1
npm run test:integration --workspace=@isp/database
docker compose -f docker-compose.test.yml down --volumes
```

`ORVEX_REQUIRE_LIVE_POSTGRES=1` asserts that the database is empty before migration and turns a
missing DSN into a failure. This mode is intended for a fresh CI Compose volume. Without that flag,
the command emits a clear skip only when one or both DSNs are absent. It never treats an attempted
database connection or assertion failure as a skip.

Application deployments set both `CONTROL_DATABASE_MIGRATION_URL` and
`TENANT_DATABASE_MIGRATION_URL`; `npm run db:migrate --workspace=@isp/database` migrates both planes
and rejects a partial pair. `DATABASE_MIGRATION_URL` remains the single-database integration-test
input. Tenant read/audit evidence is written to the control plane, where the canonical support-grant
reference exists, while operational summaries are read from the migrated tenant plane.

## Required repository integration

The root integration script and CI workflow provide the following mandatory wiring:

1. The root `test:integration` script invokes the database workspace integration suite.
2. CI exports migrator/runtime DSNs instead of the bootstrap credential.
3. CI sets `ORVEX_REQUIRE_LIVE_POSTGRES=1` on a fresh isolated Compose project.
4. `.env.example` separates bootstrap, migrator, runtime, control, and tenant-plane DSNs.

## Operational boundaries

The migration runner validates SHA-256 checksums for applied SQL and refuses a changed historical
migration. A new SQL file is the only supported forward path. Role creation is infrastructure/DBA
work because transactional schema migrations must not require cluster-level `CREATEROLE`.

The runtime role currently has explicit DML on the Phase 0 identity and tenant tables, except that
`audit_events` is `SELECT, INSERT` only. Each future migration must grant only the operations its
new objects need. The hardening migration also removes public default table and function access.

## Existing database upgrade

Container initialization runs only for a new data directory. For a pre-hardening database, a DBA
must run `infra/docker/postgres/admin/provision-existing-database.sh` once per physical database
before `db:migrate`. The script requires an explicit bootstrap DSN, database name, and legacy owner;
it creates or reconciles the restricted roles and then invokes the shared adoption bridge. The
bridge applies the immutable baseline inside a randomly named, transaction-scoped reference schema
and compares normalized PostgreSQL catalogs field by field. The comparison covers every relevant
relation kind, column/type/default/nullability, enum, constraint (including PostgreSQL 18 catalog
forms), index, RLS flag/policy expression, function attribute/body, and trigger condition/column
mask/argument/function/event, rewrite rules, inheritance, column ACLs, operators, casts, collations,
and operator classes/families. Privileged catalog reads run with a `pg_catalog`-only search path.
The bridge rejects any pre-existing new-style migration ledger, creates and compares fresh
real/reference ledgers, verifies the target database and one expected object owner, refuses unsafe
legacy support rows, records the baseline's computed checksum, transfers only the enumerated
baseline objects to `orvex_owner`, and removes public access. A partial or unfamiliar schema fails
closed instead of being marked as migrated. This DBA operation is intentionally never invoked by the
application or normal migration runner.

The required CI fixture also creates `isp_upgrade_test`, applies only the immutable baseline as the
legacy bootstrap owner, verifies legacy ownership, calls the same exported adoption bridge used by
the DBA script without pre-seeding the ledger or manually reassigning objects, and then runs every
forward migration through `orvex_migrator`. CI fails unless both the empty-database and prior-schema
paths complete and the restricted runtime can observe the final migration state.
