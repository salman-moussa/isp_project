-- Run as a database administrator after tenant migration 2200. Required psql variables:
--   -v operations_context_key_id=2026-08-primary
--   -v operations_context_key_base64=<base64 for at least 32 random bytes>
-- The identical secret is injected into the API from a secret manager and is never granted to
-- orvex_runtime or the relay login.
INSERT INTO public.operations_context_keys(key_id,secret,active_from)
VALUES (
  :'operations_context_key_id',
  decode(:'operations_context_key_base64','base64'),
  clock_timestamp()
)
ON CONFLICT (key_id) DO NOTHING;

SELECT EXISTS (
  SELECT 1 FROM public.operations_context_keys
  WHERE key_id=:'operations_context_key_id' AND octet_length(secret)>=32
    AND active_from<=clock_timestamp() AND (active_until IS NULL OR active_until>clock_timestamp())
) AS operations_context_key_ready \gset

\if :operations_context_key_ready
\else
  \echo 'active Operations context key provisioning failed'
  \quit 3
\endif
