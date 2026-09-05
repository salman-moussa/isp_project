#!/bin/sh
set -eu

# DBA-only cluster-role bootstrap. Run against the control database before migration 2100.
: "${DATABASE_BOOTSTRAP_URL:?DATABASE_BOOTSTRAP_URL is required}"
: "${ORVEX_CONTROL_API_DB_PASSWORD:?ORVEX_CONTROL_API_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=control_api_password="$ORVEX_CONTROL_API_DB_PASSWORD" \
  "$DATABASE_BOOTSTRAP_URL" <<-'SQL'
  SET search_path = pg_catalog;

  SELECT 'CREATE ROLE orvex_control_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_control_runtime')\gexec
  SELECT format(
    'CREATE ROLE orvex_control_api LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
    :'control_api_password'
  ) WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_control_api')\gexec

  ALTER ROLE orvex_control_runtime NOLOGIN
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ALTER ROLE orvex_control_api LOGIN PASSWORD :'control_api_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ALTER ROLE orvex_control_api SET search_path = pg_catalog, public;
  GRANT orvex_control_runtime TO orvex_control_api
    WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  SELECT format('GRANT CONNECT ON DATABASE %I TO orvex_control_api', current_database())\gexec
SQL
