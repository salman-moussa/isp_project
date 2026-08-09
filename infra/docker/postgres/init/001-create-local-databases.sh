#!/bin/sh
set -eu

# Runs only on first initialization of a local/test volume. The POSTGRES_USER remains a
# bootstrap superuser and must never be used by the application or migration runner.
: "${ORVEX_RUNTIME_DB_PASSWORD:?ORVEX_RUNTIME_DB_PASSWORD is required}"
: "${ORVEX_MIGRATOR_DB_PASSWORD:?ORVEX_MIGRATOR_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=database_name="$POSTGRES_DB" \
  --set=runtime_password="$ORVEX_RUNTIME_DB_PASSWORD" \
  --set=migrator_password="$ORVEX_MIGRATOR_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<-'SQL'
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
  ALTER DATABASE :"database_name" OWNER TO orvex_owner;
  REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
  GRANT CONNECT ON DATABASE :"database_name" TO orvex_migrator, orvex_runtime;
  ALTER SCHEMA public OWNER TO orvex_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO orvex_runtime;

  ALTER ROLE orvex_migrator SET search_path = public, pg_catalog;
  ALTER ROLE orvex_runtime SET search_path = public, pg_catalog;

  SELECT 'CREATE DATABASE isp_tenant_template OWNER orvex_owner'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'isp_tenant_template')\gexec
  REVOKE ALL ON DATABASE isp_tenant_template FROM PUBLIC;
  GRANT CONNECT ON DATABASE isp_tenant_template TO orvex_migrator, orvex_runtime;
SQL

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname isp_tenant_template <<-'SQL'
  ALTER SCHEMA public OWNER TO orvex_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO orvex_runtime;
SQL
