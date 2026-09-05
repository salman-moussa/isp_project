#!/bin/sh
set -eu

# DBA-only, ledger-independent role bootstrap for an already migrated database. This script
# changes cluster roles and grants only; it never adopts or mutates the application's schema.
: "${DATABASE_BOOTSTRAP_URL:?DATABASE_BOOTSTRAP_URL is required}"
: "${ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD:?ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=relay_password="$ORVEX_FINANCE_AUDIT_RELAY_DB_PASSWORD" \
  "$DATABASE_BOOTSTRAP_URL" <<-'SQL'
  SET search_path = pg_catalog;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orvex_owner') THEN
      RAISE EXCEPTION 'orvex_owner must exist before finance audit relay role bootstrap';
    END IF;
  END
  $$;

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
  ALTER ROLE orvex_finance_audit_relay SET search_path = pg_catalog, public;
  GRANT orvex_finance_audit_relay_owner TO orvex_owner
    WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  SELECT format(
    'GRANT CONNECT ON DATABASE %I TO orvex_finance_audit_relay',
    current_database()
  )\gexec
  GRANT USAGE ON SCHEMA public TO orvex_finance_audit_relay;
SQL
