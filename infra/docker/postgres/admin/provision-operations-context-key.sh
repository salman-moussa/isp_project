#!/bin/sh
set -eu

: "${TENANT_DATABASE_BOOTSTRAP_URL:?TENANT_DATABASE_BOOTSTRAP_URL is required}"
: "${OPERATIONS_CONTEXT_KEY_ID:?OPERATIONS_CONTEXT_KEY_ID is required}"
: "${OPERATIONS_CONTEXT_SECRET_BASE64:?OPERATIONS_CONTEXT_SECRET_BASE64 is required}"

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repository_root="$(CDPATH= cd -- "$script_directory/../../../.." && pwd)"

psql --set=ON_ERROR_STOP=1 \
  --set=operations_context_key_id="$OPERATIONS_CONTEXT_KEY_ID" \
  --set=operations_context_key_base64="$OPERATIONS_CONTEXT_SECRET_BASE64" \
  --file="$repository_root/packages/database/src/operations/provisioning.sql" \
  "$TENANT_DATABASE_BOOTSTRAP_URL"
