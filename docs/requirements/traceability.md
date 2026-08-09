# Requirements traceability matrix

Status: Seeded plan; an initial vertical slice exists, but no row is credited until its
implementation and test evidence is audited.  
Rule: `Planned` is not evidence. Change to `Implemented`, `Verified`, or `Accepted exception` only
with clickable repository/CI/artifact links and reviewer/date.

## Evidence states

| State                | Meaning                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| `Planned`            | Owner, module and verification are identified; implementation is not claimed.       |
| `Implemented`        | Code/config/schema and migration links exist; verification may still be incomplete. |
| `Verified`           | Required automated/manual checks passed in a named immutable run and review gate.   |
| `Blocked`            | External fact/authority prevents progress; decision/risk link required.             |
| `Accepted exception` | Authorized, time-bounded exception with compensating control and expiry.            |

## Seed matrix

Module names are planned repository boundaries: `core/control`, `core/identity`, and `core/tenant`
are bounded contexts composed by `apps/api`; web/mobile/worker/package paths follow the architecture
overview. Test IDs are stable planned suites; their future manifests live under `docs/testing` and
executable tests beside the owning module.

| Requirement(s)        | Planned implementation                                                         | Planned verification / evidence                                                                   | Owner / independent review             | State   |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------- | ------- |
| PRD-BND-001, 003, 007 | route manifests; `packages/contracts`; terminology lint                        | T-E2E-BOUND-001 route/auth inventory; doc/schema terminology review                               | Product + API / QA                     | Planned |
| PRD-BND-002           | `core/public-documents`; object adapter; public web route                      | T-API-PUB-001 token disclosure/expiry/revoke/rate; T-SEC-PUB-001 enumeration                      | API / Security                         | Planned |
| PRD-BND-004           | `core/control/subscriptions`; protected-action policy; network event allowlist | T-ARCH-BOUND-001 dependency rule; T-E2E-SUB-004 restrict/restore; T-NET-NEG-001 no dispatch       | Platform + Network / Security          | Planned |
| PRD-BND-005           | support gateway; aggregate telemetry projection                                | T-ISO-SUPPORT-001; T-PRIV-AGG-001 small-cell/PII review                                           | Platform / Security                    | Planned |
| PRD-BND-006           | all apps/services/infra workspaces                                             | build manifest and health smoke per surface                                                       | Delivery / QA                          | Planned |
| PRD-IAM-001..005      | `core/identity` permission catalogue, policies, approval aggregate             | T-AUTHZ-MATRIX-001; T-APPROVAL-001 self/expiry/replay; static role-check rule                     | Identity / Security                    | Planned |
| PRD-IAM-006, 007, 010 | web session service; mobile token/device service; MFA/recovery                 | T-AUTH-SESSION-001; T-AUTH-MFA-001; T-MOB-REVOKE-001                                              | Identity + Mobile / Security           | Planned |
| PRD-IAM-008           | support request/session/gateway/banner                                         | T-E2E-SUPPORT-001; T-ISO-SUPPORT-001; audit assertion                                             | Platform Web/API / Security            | Planned |
| PRD-IAM-009           | append-only audit writer/projection/export                                     | T-DB-AUDIT-001 immutability; T-AUDIT-COVER-001 event fields; tamper test                          | Core API / Security                    | Planned |
| PRD-CTL-001, 013      | control reporting projections/API/platform web                                 | T-API-DRILL-CTL-001 count/filter reconciliation; T-EXPORT-001                                     | Platform Web/API / QA                  | Planned |
| PRD-CTL-002, 003      | client aggregate, documents/activity, commands and profile UI                  | T-E2E-CLIENT-001; T-AUTHZ-CLIENT-001; T-UPLOAD-001                                                | Platform Web/API / Security            | Planned |
| PRD-CTL-004           | sales/quote/conversion contexts                                                | T-E2E-LEADLIVE-001 success/retry/partial; quote snapshot test                                     | Platform API/Web / QA                  | Planned |
| PRD-CTL-005..007      | catalogue/version/entitlement/override contexts                                | T-DOM-ENT-001; T-E2E-PKG-001; T-LIMIT-001 protected existing/actions                              | Platform API / Product + QA            | Planned |
| PRD-CTL-008           | subscription state machine/outbox                                              | T-PROP-SUBSTATE-001; T-E2E-SUB-004; T-NET-NEG-001                                                 | Platform API / Security                | Planned |
| PRD-CTL-009, 010      | client ledger/invoice/payment/allocation/PDF                                   | T-PROP-MONEY-001; T-CONC-PAY-001; T-E2E-CLTBILL-001; T-PDF-BI-001                                 | Finance API / Finance reviewer         | Planned |
| PRD-CTL-011           | provisioning/deployment workflow and infra adapters                            | T-E2E-PROV-001 idempotent resume; T-OPS-ROLLBACK-001; secret log check                            | Deployments + SRE / Security           | Planned |
| PRD-CTL-012           | platform support/SLA aggregate                                                 | T-E2E-SUPPORT-001; SLA table tests                                                                | Platform API/Web / QA                  | Planned |
| PRD-TEN-001, 010      | tenant projections/report/export jobs and ISP web                              | T-API-DRILL-TEN-001; T-REPORT-RECON-001; T-EXPORT-001                                             | Tenant API/Web / QA                    | Planned |
| PRD-TEN-002..005      | subscriber/location/service/attachment contexts                                | T-E2E-SUBSCRIBER-001; T-DUP-001; T-FIELD-PII-001; T-LOC-001                                       | Tenant API/Web / Security              | Planned |
| PRD-TEN-006           | installation aggregate/web flow/network handoff                                | T-E2E-INSTALL-001; activation prerequisite tests                                                  | Tenant API/Web / QA                    | Planned |
| PRD-TEN-007           | internal support context                                                       | T-E2E-ISPSUPPORT-001; T-BOUND-NOPORTAL-001                                                        | Tenant API/Web / QA                    | Planned |
| PRD-TEN-008           | configuration/versioned policies/admin UI                                      | T-CONFIG-001 effective/version; T-AUTHZ-CONFIG-001                                                | Tenant API/Web / Security              | Planned |
| PRD-TEN-009           | import job/parser/staging tables                                               | T-IMPORT-001 mixed/error/retry; T-SEC-IMPORT-001                                                  | Tenant API / Security                  | Planned |
| PRD-FIN-001, 002, 009 | shared money/value objects; exchange/tax policy                                | T-PROP-MONEY-001 separation/rounding; T-PROP-TAX-001; T-FX-001                                    | Finance API / Finance reviewer         | Planned |
| PRD-FIN-003           | immutable ledger/documents and correction links                                | T-DB-IMMUT-001; T-E2E-CORRECT-001                                                                 | Finance API / Security + Finance       | Planned |
| PRD-FIN-004           | billing schedules/runs/invoices/proration                                      | T-PROP-BILL-001; T-E2E-BILLRUN-001 retry failed only; T-CONC-NUM-001                              | Tenant Finance / Finance reviewer      | Planned |
| PRD-FIN-005           | payment/allocation/credit/deposit contexts                                     | T-PROP-ALLOC-001; T-CONC-PAY-001; T-IDEMP-PAY-001                                                 | Tenant Finance / Finance reviewer      | Planned |
| PRD-FIN-006           | cashier/collector shift/reconciliation contexts                                | T-PROP-RECON-001; T-E2E-CLOSE-001                                                                 | Tenant Finance / Finance reviewer      | Planned |
| PRD-FIN-007           | receipt renderer/printer/share and audit                                       | T-PDF-BI-001; T-MOB-PRINT-001; reprint audit test                                                 | Finance + Mobile / QA                  | Planned |
| PRD-FIN-008           | OMT/Whish manual/fake adapters                                                 | T-CONTRACT-PAYPROV-001; T-E2E-MANUALPAY-001                                                       | Integrations / Security                | Planned |
| PRD-FIN-010           | scoped number sequence + local/canonical mapping                               | T-CONC-NUM-001; T-MOB-RECEIPT-001                                                                 | Finance + Mobile / QA                  | Planned |
| PRD-MOB-001, 002      | mobile auth/bootstrap/assignment/screens                                       | T-MOB-E2E-DAY-001; T-MOB-SCOPE-001                                                                | Mobile / Security + QA                 | Planned |
| PRD-MOB-003..006      | encrypted store/outbox/sync/conflict/payment/receipt                           | T-MOB-FAULT-001 kill/restart; T-MOB-SYNC-001 duplicate/order; T-MOB-CONFLICT-001; T-IDEMP-PAY-001 | Mobile + API / Security + Finance      | Planned |
| PRD-MOB-007           | printer adapter and receipt UI                                                 | T-MOB-PRINT-001 success/fail/disconnect/no-loss                                                   | Mobile / QA                            | Planned |
| PRD-MOB-008           | mobile reconciliation draft/submit/server aggregate                            | T-MOB-RECON-001 offline/retry/discrepancy                                                         | Mobile + Finance / Finance reviewer    | Planned |
| PRD-MOB-009           | device auth/key store/revocation                                               | T-MOB-REVOKE-001 bootstrap/sync/refresh; storage inspection                                       | Mobile + Identity / Security           | Planned |
| PRD-MOB-010           | map adapter/deep links/permission UI                                           | T-MOB-MAP-001 deny/fallback/no tracking                                                           | Mobile / Privacy review                | Planned |
| PRD-NET-001, 008      | isolated `network-worker`, secret references, egress policy                    | T-ARCH-NET-001; T-SEC-SECRET-001 logs/exports; deploy network test                                | Network + SRE / Security               | Planned |
| PRD-NET-002, 003      | RouterOS adapter/domain commands/observations                                  | T-CONTRACT-ROS-001; T-NET-CMD-001; T-NET-FRESH-001                                                | Network / QA                           | Planned |
| PRD-NET-004           | bulk batch/impact preview/child jobs                                           | T-E2E-NETBULK-001 partial/retry/audit; approval matrix                                            | Network + ISP Web / Security           | Planned |
| PRD-NET-005..007      | durable jobs/attempts/circuit/DLQ/reconciliation                               | T-NET-FAILMATRIX-001; T-NET-RESTART-001; T-NET-UNCERTAIN-001                                      | Network / Security + QA                | Planned |
| PRD-NET-009           | RouterOS simulator                                                             | simulator scenario manifest and CI contract result                                                | Network / QA                           | Planned |
| PRD-INT-001, 003      | provider contracts/adapters/config/health/flags                                | T-CONTRACT-ADAPTER-001 per adapter; disabled-mode config smoke                                    | Integrations / Security                | Planned |
| PRD-INT-002           | webhook ingress/inbox/quarantine/replay                                        | T-API-WEBHOOK-001 signature/time/replay/duplicate/unknown                                         | Integrations / Security                | Planned |
| PRD-LOC-001, 002      | `packages/ui` locale primitives plus app translation modules and bidi tokens   | T-I18N-COMPLETE-001; T-VIS-RTL-001; T-A11Y-BI-001                                                 | UX + all UI / QA                       | Planned |
| PRD-LOC-003, 004      | shared time/phone formatters and document fonts                                | T-TZ-BEIRUT-001 DST; T-PHONE-LB-001; T-PDF-BI-001                                                 | Core + UX / QA                         | Planned |
| PRD-UX-001, 002       | shared UI/state patterns and app flows                                         | T-A11Y-WEB-001; T-MOB-A11Y-001; E2E negative-state inventory                                      | UI teams / UX + QA                     | Planned |
| PRD-API-001, 002      | `packages/contracts/openapi`; API middleware/conventions                       | OpenAPI lint/breaking check; T-CONTRACT-CLIENT-001; route-policy inventory                        | API / Architecture                     | Planned |
| PRD-SEC-001           | tenant resolver/connections/scoped adapters/guardrails                         | T-ISO-ALL-001 API/DB/job/cache/file/realtime/export/backup/log                                    | All backend / Security                 | Planned |
| PRD-SEC-002           | TLS/storage/KMS/secret/mobile encryption/backups                               | configuration tests; storage inspection; rotation/restore exercises                               | Security + SRE / Independent security  | Planned |
| PRD-SEC-003           | quarantine/scanner/object policy/signed URLs                                   | T-UPLOAD-ABUSE-001; T-ISO-FILE-001                                                                | Files / Security                       | Planned |
| PRD-SEC-004, 005      | security middleware/validation/headers/rate policy                             | ASVS suite; DAST; T-API-ABUSE-001; T-RATE-001                                                     | API + SRE / Security                   | Planned |
| PRD-SEC-006           | deterministic fraud rules/review queue                                         | T-RULE-FRAUD-001 table-driven; audit/alert evidence                                               | Finance + Security / QA                | Planned |
| PRD-OPS-001           | workspace scripts/Compose/fakes/seeds                                          | clean bootstrap transcript; validation run                                                        | Developer Experience / QA              | Planned |
| PRD-OPS-002           | CI workflows and branch/release gates                                          | intentionally failing gate tests; immutable CI run                                                | SRE / Security + QA                    | Planned |
| PRD-OPS-003, 004      | artifacts/IaC/environments/deploy/rollback                                     | staging promote/rollback exercise; IaC and image scan evidence                                    | SRE / Security                         | Planned |
| PRD-OPS-005           | `packages/observability`, collectors/dashboards/alerts                         | telemetry contract tests; alert fire/recover/runbook drill                                        | SRE / Operations review                | Planned |
| PRD-OPS-006           | backup/PITR/object manifests/restore tooling                                   | T-DR-CTRL-001; T-DR-TENANT-001; T-DR-FULL-001; object restore                                     | SRE / Independent reviewer             | Planned |
| PRD-NFR-001, 002      | indexed/query projections; web/mobile feedback patterns                        | T-LOAD-REF-001 p95/error/saturation; UX timing checks                                             | Architecture + UI / Performance review | Planned |
| PRD-NFR-003, 004      | transactional writes, queues, pagination/async job framework                   | T-FAULT-001; T-NPLUS1-001; T-LIMITS-001; backlog/soak                                             | Backend / QA                           | Planned |
| PRD-QLT-001           | test projects/fixtures/contracts/CI reports                                    | required suite manifest and phase-gate run                                                        | QA / Delivery                          | Planned |
| PRD-QLT-002           | all modules, evidence bundle, release checklist                                | independent final audit against 20 acceptance criteria                                            | Delivery / Independent reviewer        | Planned |

## Master-prompt coverage map

| Prompt section                             | Catalogue coverage                                               |
| ------------------------------------------ | ---------------------------------------------------------------- |
| 1–4 mission/boundaries/surfaces            | PRD-BND-\*                                                       |
| 5 roles/authorization                      | PRD-IAM-\*                                                       |
| 6 Orvex ISP Control Center                 | PRD-CTL-_, PRD-FIN-_                                             |
| 7 tenant/mobile/MikroTik                   | PRD-TEN-_, PRD-FIN-_, PRD-MOB-_, PRD-NET-_                       |
| 8 flows and 9 screens                      | PRD-CTL-_, PRD-TEN-_, PRD-MOB-_, PRD-NET-_, PRD-UX-002           |
| 10 localization                            | PRD-LOC-\*                                                       |
| 11 UX/accessibility                        | PRD-UX-\*                                                        |
| 12–15 architecture/domain/API/integrations | PRD-API-_, PRD-SEC-001, PRD-INT-_, PRD-NET-\*, architecture/ADRs |
| 16 security                                | PRD-IAM-_, PRD-SEC-_                                             |
| 17 testing                                 | PRD-QLT-\* plus planned test IDs above                           |
| 18 operations                              | PRD-OPS-\*                                                       |
| 19 performance                             | PRD-NFR-\*                                                       |
| 20–25 delivery/docs/DoD/final/rules        | [task plan](../task-plan.md), PRD-QLT-\* and this matrix         |

## Evidence update checklist

For each changed row: link exact requirement acceptance criteria; implementation
file/schema/migration; positive and negative tests; immutable CI run and relevant report;
security/tenancy review; screenshots only as supplemental UX evidence; migration/rollback/runbook
where applicable; reviewer and date. Never use a screenshot, coverage percentage, or author's
assertion as sole evidence for a financial or security invariant.
