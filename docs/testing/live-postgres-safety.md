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

## Required repository integration

The root integration script and CI workflow are outside the database slice. Their owner must:

1. Add a root `test:integration` script that invokes workspace integration scripts.
2. Export both DSNs above instead of exporting the bootstrap `isp_test` credential.
3. Set `ORVEX_REQUIRE_LIVE_POSTGRES=1` in CI after starting a fresh test Compose project.
4. Add local `.env.example` values for `ORVEX_RUNTIME_DB_PASSWORD`, `ORVEX_MIGRATOR_DB_PASSWORD`,
   `DATABASE_RUNTIME_URL`, and `DATABASE_MIGRATION_URL`; update the legacy `DATABASE_URL` to use
   `orvex_runtime`.

## Operational boundaries

The migration runner validates SHA-256 checksums for applied SQL and refuses a changed historical
migration. A new SQL file is the only supported forward path. Role creation is infrastructure/DBA
work because transactional schema migrations must not require cluster-level `CREATEROLE`.

The runtime role currently has explicit DML on the Phase 0 identity and tenant tables, except that
`audit_events` is `SELECT, INSERT` only. Each future migration must grant only the operations its
new objects need. The hardening migration also removes public default table and function access.
