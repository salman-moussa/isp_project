#!/bin/sh
set -eu

# DBA-only post-migration key installation. Use a new key ID for rotation; runtime cannot read it.
: "${DATABASE_BOOTSTRAP_URL:?DATABASE_BOOTSTRAP_URL is required}"
: "${CONTROL_CONTEXT_KEY_ID:?CONTROL_CONTEXT_KEY_ID is required}"
: "${CONTROL_CONTEXT_SECRET_BASE64:?CONTROL_CONTEXT_SECRET_BASE64 is required}"

psql \
  --set=ON_ERROR_STOP=1 \
  --set=context_key_id="$CONTROL_CONTEXT_KEY_ID" \
  --set=context_secret_base64="$CONTROL_CONTEXT_SECRET_BASE64" \
  "$DATABASE_BOOTSTRAP_URL" <<-'SQL'
  BEGIN;
  SET search_path = pg_catalog, public;
  CREATE TEMP TABLE supplied_control_context_key(key_id text, secret bytea) ON COMMIT DROP;
  INSERT INTO supplied_control_context_key
  VALUES (:'context_key_id', decode(:'context_secret_base64', 'base64'));
  DO $block$
  DECLARE supplied_id text;
  DECLARE supplied bytea;
  DECLARE existing bytea;
  BEGIN
    SELECT key_id, secret INTO STRICT supplied_id, supplied FROM supplied_control_context_key;
    IF octet_length(supplied) < 32 THEN
      RAISE EXCEPTION 'Control Center context keys require at least 32 bytes';
    END IF;
    SELECT secret INTO existing FROM control_center_context_keys WHERE key_id = supplied_id;
    IF FOUND AND existing IS DISTINCT FROM supplied THEN
      RAISE EXCEPTION 'key ID already exists with different material; rotate with a new key ID';
    END IF;
    INSERT INTO control_center_context_keys(key_id, secret, active_from)
    VALUES (supplied_id, supplied, clock_timestamp())
    ON CONFLICT (key_id) DO NOTHING;
  END
  $block$;
  COMMIT;
SQL
