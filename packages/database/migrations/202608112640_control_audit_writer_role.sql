-- orvex:database=control
-- Tenant-scoped control audit evidence is appended only through the dedicated Control runtime role.

REVOKE INSERT ON TABLE audit_events FROM orvex_runtime;
GRANT INSERT ON TABLE audit_events TO orvex_control_runtime;
