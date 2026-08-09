# Security requirements traceability

Status values: `designed`, `implemented`, `verified`, `accepted-exception`. The baseline below is
`designed`; update only with linked implementation and executed evidence.

| ID      | Requirement                                             | Planned implementation                                        | Required verification                                                  | Status   |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| SEC-001 | Verified tenant context at every boundary               | Central resolver and scoped storage/async helpers             | Cross-tenant API, DB, job, cache, file, realtime, export, backup tests | designed |
| SEC-002 | No vendor browsing without support grant                | Approval gateway and non-refreshable scoped token             | Request/approve/banner/expiry/revoke/audit E2E plus negative cases     | designed |
| SEC-003 | Subscription restriction cannot affect Internet service | Module/event separation and network-worker deny rule          | Contract/static dependency/negative E2E test                           | designed |
| SEC-004 | Strong privileged authentication                        | MFA, step-up, session/device controls                         | Auth/session abuse and recovery tests                                  | designed |
| SEC-005 | Object and field authorization                          | Central permission catalogue/policies                         | Role/scope/record/field matrix                                         | designed |
| SEC-006 | Idempotent financial/mobile/provider writes             | Scoped key, request hash, unique record, transaction          | Replay, changed-payload and concurrency tests                          | designed |
| SEC-007 | Posted record immutability                              | State constraints and linked correction chains                | API and direct-database mutation tests                                 | designed |
| SEC-008 | Currency separation                                     | Decimal + currency, separate aggregates                       | Property tests across API/UI/PDF/report/sync                           | designed |
| SEC-009 | Mobile confidentiality and revocation                   | Encrypted DB, secure keystore, device-bound tokens            | Device compromise/revocation tests                                     | designed |
| SEC-010 | Safe upload and download                                | Quarantine/scanner/signed tenant URL pipeline                 | Polyglot, MIME mismatch, bomb, malware, path/prefix tests              | designed |
| SEC-011 | Web/API common attack resistance                        | Validation, parameterization, CSP/CSRF/CORS/SSRF controls     | SAST, integration tests and staging DAST                               | designed |
| SEC-012 | Webhook authenticity and replay resistance              | Provider signature adapters, timestamp/nonce, inbox           | Forgery/replay/duplicate/order/unknown tests                           | designed |
| SEC-013 | Safe MikroTik automation                                | Isolated worker, typed commands, secret refs, reconciliation  | Simulator success/failure/uncertain/retry matrix                       | designed |
| SEC-014 | Protected secrets                                       | Runtime injection, reference fields, redaction and rotation   | Secret scan, log inspection, rotation drill                            | designed |
| SEC-015 | Secure build and artifacts                              | Lockfile, least privilege, SAST/dependency/image scans, SBOM  | Required CI gates and artifact metadata                                | designed |
| SEC-016 | Recoverable encrypted data                              | Encrypted tiered backups and isolated restore                 | Control, single-tenant, full and object restore exercises              | designed |
| SEC-017 | Tamper-evident privileged audit                         | Append-only audit with integrity chain/immutable sink         | Mutation resistance, coverage and export-access tests                  | designed |
| SEC-018 | Safe public verification                                | Opaque scoped expiring/revocable token and minimum disclosure | Enumeration, leakage, expiry, rate-limit tests                         | designed |
| SEC-019 | PII-safe observability                                  | Allowlisted structured fields and tenant-safe correlation     | Automated redaction tests and sampled review                           | designed |
| SEC-020 | Controlled retention/export/deletion                    | Tenant policy, legal hold, authorized audited workflows       | Retention job, export ownership, deletion boundary tests               | designed |
