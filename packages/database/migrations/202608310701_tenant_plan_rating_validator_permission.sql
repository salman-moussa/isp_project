-- The runtime role must be able to evaluate JSON safety checks attached to tenant writes.
GRANT EXECUTE ON FUNCTION operations_json_contains_secret_key(jsonb) TO orvex_runtime;
