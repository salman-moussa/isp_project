# Residual risk register

This register records known Phase 0/1 uncertainty. Risk acceptance requires an authorized owner,
date, rationale, compensating controls and expiry; documentation authors cannot accept business
risk.

| ID     | Risk / current uncertainty                                                                                      | Likelihood / impact | Required treatment before production                                                        | Owner                   | State |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- | ----------------------- | ----- |
| RR-001 | Final tenancy topology and database provisioning automation are not yet implemented or isolation-tested         | Med / Critical      | ADR, least-privilege roles, isolation suites across every boundary                          | Architecture + backend  | open  |
| RR-002 | Lebanese privacy, financial, tax/VAT, retention and breach-notification obligations need qualified legal review | Med / High          | Counsel-approved policy matrix and data-processing terms                                    | Product owner + counsel | open  |
| RR-003 | OMT, Whish, POS, OTP and messaging live APIs/credentials/contracts are unavailable                              | Med / High          | Keep manual/fake mode; review provider contract/security; production enablement gate        | Integrations owner      | open  |
| RR-004 | Mobile database encryption, rooted-device policy and supported OS floor are undecided                           | Med / High          | Mobile ADR, device threat tests and MDM/revocation policy                                   | Mobile + security       | open  |
| RR-005 | MikroTik library/protocol topology and router reachability model are undecided                                  | Med / Critical      | Isolated connector ADR, credential vault, egress design, simulator matrix and pilot         | Network + security      | open  |
| RR-006 | Backup repository, KMS, geographic placement and customer-specific data residency are undecided                 | Med / Critical      | Deployment-specific encrypted off-site design and accepted RPO/RTO                          | SRE + owner             | open  |
| RR-007 | Security scan and action versions will age; current workflow uses major-version actions for bootstrap           | Med / High          | Pin reviewed action commit SHAs and automate controlled update PRs before protected release | DevOps + security       | open  |
| RR-008 | SLO capacity assumptions are provisional until representative workload and data exist                           | High / Med          | Approve reference profile, run load/soak/queue tests, tune thresholds                       | SRE + product           | open  |
| RR-009 | Append-only/tamper-evident audit storage mechanism is not selected                                              | Med / High          | ADR and mutation/coverage/export-access verification                                        | Backend + security      | open  |
| RR-010 | Restore, failover, DAST and penetration tests have not been executed                                            | High / Critical     | Execute in isolated staging, retain evidence, remediate critical/high findings              | SRE + security          | open  |
