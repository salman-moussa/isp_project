-- orvex:database=control
-- Route canonical session validation and denial evidence through the dedicated Control runtime role.

REVOKE INSERT ON TABLE security_events FROM orvex_runtime;
GRANT INSERT ON TABLE security_events TO orvex_control_runtime;
