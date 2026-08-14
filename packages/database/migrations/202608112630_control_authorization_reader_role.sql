-- orvex:database=control
-- Canonical support authorization is read only after the API assumes the Control runtime role.

GRANT SELECT ON TABLE support_grants TO orvex_control_runtime;
