#!/bin/sh
set -eu

# Runs only on first initialization of the local development volume.
# Identifiers are constants; no user-controlled value is interpolated into SQL.
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'SQL'
  SELECT 'CREATE DATABASE isp_tenant_template'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'isp_tenant_template')\gexec
SQL

