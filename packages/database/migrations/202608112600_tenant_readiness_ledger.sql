-- orvex:database=tenant
-- The API readiness probe verifies exact applied migration names. The ledger is append-only under
-- the migrator/owner boundary; tenant runtime receives read-only visibility and no mutation grant.
REVOKE ALL ON TABLE public._orvex_migrations FROM PUBLIC;
GRANT SELECT ON TABLE public._orvex_migrations TO orvex_runtime;
