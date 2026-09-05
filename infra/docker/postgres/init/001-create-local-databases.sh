#!/bin/sh
set -eu

# Runs only on first initialization of a local/test volume. The POSTGRES_USER remains a
# bootstrap superuser and must never be used by the application or migration runner.
: "${ORVEX_RUNTIME_DB_PASSWORD:?ORVEX_RUNTIME_DB_PASSWORD is required}"
: "${ORVEX_CONTROL_API_DB_PASSWORD:?ORVEX_CONTROL_API_DB_PASSWORD is required}"
: "${ORVEX_MIGRATOR_DB_PASSWORD:?ORVEX_MIGRATOR_DB_PASSWORD is required}"
: "${ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD:?ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD is required}"
: "${ORVEX_NETWORK_WORKER_DB_PASSWORD:?ORVEX_NETWORK_WORKER_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=database_name="$POSTGRES_DB" \
  --set=runtime_password="$ORVEX_RUNTIME_DB_PASSWORD" \
  --set=control_api_password="$ORVEX_CONTROL_API_DB_PASSWORD" \
  --set=migrator_password="$ORVEX_MIGRATOR_DB_PASSWORD" \
  --set=relay_password="$ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD" \
  --set=network_worker_password="$ORVEX_NETWORK_WORKER_DB_PASSWORD" \
  --set=create_relay_roles="${ORVEX_CREATE_FINANCE_AUDIT_RELAY_ROLES:-1}" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<-'SQL'
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

  SELECT 'CREATE ROLE orvex_control_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_control_runtime')\gexec
  SELECT format(
    'CREATE ROLE orvex_control_api LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'control_api_password'
  ) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_control_api')\gexec

  ALTER ROLE orvex_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER ROLE orvex_migrator LOGIN PASSWORD :'migrator_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ALTER ROLE orvex_runtime LOGIN PASSWORD :'runtime_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ALTER ROLE orvex_control_runtime NOLOGIN
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ALTER ROLE orvex_control_api LOGIN PASSWORD :'control_api_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  GRANT orvex_control_runtime TO orvex_control_api
    WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  GRANT orvex_owner TO orvex_migrator;

  SELECT format(
    'CREATE ROLE orvex_network_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'network_worker_password'
  ) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_network_worker')\gexec
  ALTER ROLE orvex_network_worker LOGIN PASSWORD :'network_worker_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

  \if :create_relay_roles
  SELECT 'CREATE ROLE orvex_finance_audit_relay_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_finance_audit_relay_owner')\gexec
  SELECT format(
    'CREATE ROLE orvex_finance_audit_relay LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'relay_password'
  ) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_finance_audit_relay')\gexec

  ALTER ROLE orvex_finance_audit_relay_owner NOLOGIN
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER ROLE orvex_finance_audit_relay LOGIN PASSWORD :'relay_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

  GRANT orvex_finance_audit_relay_owner TO orvex_owner
    WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  \endif
  ALTER DATABASE :"database_name" OWNER TO orvex_owner;
  REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
  GRANT CONNECT ON DATABASE :"database_name" TO orvex_migrator, orvex_runtime, orvex_control_api,
    orvex_network_worker;
  \if :create_relay_roles
  GRANT CONNECT ON DATABASE :"database_name" TO orvex_finance_audit_relay;
  \endif
  ALTER SCHEMA public OWNER TO orvex_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO orvex_runtime;

  ALTER ROLE orvex_migrator SET search_path = pg_catalog, public;
  ALTER ROLE orvex_runtime SET search_path = pg_catalog, public;
  ALTER ROLE orvex_control_api SET search_path = pg_catalog, public;
  ALTER ROLE orvex_network_worker SET search_path = pg_catalog, network_worker;
  \if :create_relay_roles
  ALTER ROLE orvex_finance_audit_relay SET search_path = pg_catalog, public;
  \endif

  SELECT 'CREATE DATABASE isp_tenant_template OWNER orvex_owner'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'isp_tenant_template')\gexec
  REVOKE ALL ON DATABASE isp_tenant_template FROM PUBLIC;
  GRANT CONNECT ON DATABASE isp_tenant_template TO orvex_migrator, orvex_runtime,
    orvex_network_worker;
  \if :create_relay_roles
  GRANT CONNECT ON DATABASE isp_tenant_template TO orvex_finance_audit_relay;
  \endif
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname isp_tenant_template <<-'SQL'
  SET search_path = pg_catalog;
  ALTER SCHEMA public OWNER TO orvex_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO orvex_runtime;
SQL

if [ "${ORVEX_CREATE_UPGRADE_TEST_DATABASE:-0}" = "1" ]; then
  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-'SQL'
    SET search_path = pg_catalog;
    SELECT 'CREATE DATABASE isp_upgrade_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'isp_upgrade_test')\gexec
SQL
fi

if [ "${ORVEX_CREATE_FINANCE_AUDIT_UPGRADE_TEST_DATABASE:-0}" = "1" ]; then
  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-'SQL'
    SET search_path = pg_catalog;
    SELECT 'CREATE DATABASE isp_finance_audit_upgrade_test OWNER orvex_owner'
    WHERE NOT EXISTS (
      SELECT FROM pg_database WHERE datname = 'isp_finance_audit_upgrade_test'
    )\gexec
    REVOKE ALL ON DATABASE isp_finance_audit_upgrade_test FROM PUBLIC;
    GRANT CONNECT ON DATABASE isp_finance_audit_upgrade_test
      TO orvex_migrator, orvex_runtime, orvex_finance_audit_relay;
SQL

  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
    --dbname isp_finance_audit_upgrade_test <<-'SQL'
    SET search_path = pg_catalog;
    ALTER SCHEMA public OWNER TO orvex_owner;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO orvex_runtime, orvex_finance_audit_relay;
SQL
fi
