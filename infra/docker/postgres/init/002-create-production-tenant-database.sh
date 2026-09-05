#!/bin/sh
set -eu

# Optional production hook. Local and test Compose projects do not set this variable.
if [ -z "${ORVEX_TENANT_DATABASE:-}" ]; then
  exit 0
fi

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=tenant_database="$ORVEX_TENANT_DATABASE" <<-'SQL'
  SET search_path = pg_catalog;
  SELECT format('CREATE DATABASE %I OWNER orvex_owner', :'tenant_database')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'tenant_database')\gexec
  SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'tenant_database')\gexec
  SELECT format(
    'GRANT CONNECT ON DATABASE %I TO orvex_migrator, orvex_runtime, orvex_finance_audit_relay, orvex_network_worker',
    :'tenant_database'
  )\gexec
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$ORVEX_TENANT_DATABASE" <<-'SQL'
  SET search_path = pg_catalog;
  ALTER SCHEMA public OWNER TO orvex_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO orvex_runtime, orvex_finance_audit_relay;
SQL
