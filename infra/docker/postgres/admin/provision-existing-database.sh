#!/bin/sh
set -eu

# Explicit DBA-only bridge for a database created before the restricted Orvex roles existed.
# Run once per control/tenant database before the forward migration runner.
: "${DATABASE_BOOTSTRAP_URL:?DATABASE_BOOTSTRAP_URL is required}"
: "${ORVEX_DATABASE_NAME:?ORVEX_DATABASE_NAME is required}"
: "${ORVEX_LEGACY_DB_OWNER:?ORVEX_LEGACY_DB_OWNER is required}"
: "${ORVEX_RUNTIME_DB_PASSWORD:?ORVEX_RUNTIME_DB_PASSWORD is required}"
: "${ORVEX_MIGRATOR_DB_PASSWORD:?ORVEX_MIGRATOR_DB_PASSWORD is required}"
: "${ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD:?ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=runtime_password="$ORVEX_RUNTIME_DB_PASSWORD" \
  --set=migrator_password="$ORVEX_MIGRATOR_DB_PASSWORD" \
  "$DATABASE_BOOTSTRAP_URL" <<-'SQL'
  SET search_path = pg_catalog;

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
  ALTER ROLE orvex_migrator SET search_path = pg_catalog, public;
  ALTER ROLE orvex_runtime SET search_path = pg_catalog, public;
  GRANT orvex_owner TO orvex_migrator;
SQL

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
"$script_directory/bootstrap-finance-audit-relay-roles.sh"
repository_root="$(CDPATH= cd -- "$script_directory/../../../.." && pwd)"
node "$repository_root/packages/database/scripts/adopt-legacy-baseline.mjs"
