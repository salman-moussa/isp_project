#!/bin/sh
set -eu

# Explicit DBA-only bridge for a database created before the restricted Orvex roles existed.
# Run once per control/tenant database before the forward migration runner.
: "${DATABASE_BOOTSTRAP_URL:?DATABASE_BOOTSTRAP_URL is required}"
: "${ORVEX_DATABASE_NAME:?ORVEX_DATABASE_NAME is required}"
: "${ORVEX_LEGACY_DB_OWNER:?ORVEX_LEGACY_DB_OWNER is required}"
: "${ORVEX_RUNTIME_DB_PASSWORD:?ORVEX_RUNTIME_DB_PASSWORD is required}"
: "${ORVEX_MIGRATOR_DB_PASSWORD:?ORVEX_MIGRATOR_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=database_name="$ORVEX_DATABASE_NAME" \
  --set=legacy_owner="$ORVEX_LEGACY_DB_OWNER" \
  --set=runtime_password="$ORVEX_RUNTIME_DB_PASSWORD" \
  --set=migrator_password="$ORVEX_MIGRATOR_DB_PASSWORD" \
  "$DATABASE_BOOTSTRAP_URL" <<-'SQL'
  DO $$
  BEGIN
    IF to_regclass('public.support_grants') IS NOT NULL AND EXISTS (
      SELECT 1 FROM support_grants
      WHERE cardinality(permissions) = 0
         OR (status = 'approved' AND approver_id IS NULL)
    ) THEN
      RAISE EXCEPTION
        'Orvex upgrade preflight failed: remediate empty permission scopes or approved grants without approvers';
    END IF;
  END
  $$;

  SELECT 'CREATE ROLE orvex_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_owner')\gexec
  SELECT format(
    'CREATE ROLE orvex_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'migrator_password'
  ) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_migrator')\gexec
  SELECT format(
    'CREATE ROLE orvex_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'runtime_password'
  ) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_runtime')\gexec

  ALTER ROLE orvex_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER ROLE orvex_migrator LOGIN PASSWORD :'migrator_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ALTER ROLE orvex_runtime LOGIN PASSWORD :'runtime_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  GRANT orvex_owner TO orvex_migrator;

  REASSIGN OWNED BY :"legacy_owner" TO orvex_owner;
  ALTER DATABASE :"database_name" OWNER TO orvex_owner;
  ALTER SCHEMA public OWNER TO orvex_owner;
  REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
  GRANT CONNECT ON DATABASE :"database_name" TO orvex_migrator, orvex_runtime;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO orvex_runtime;
SQL
