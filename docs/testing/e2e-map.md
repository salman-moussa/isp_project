# End-to-end coverage map

Status: planned journeys; mark evidence only after execution.

| ID      | Journey and critical variants                                        | Surfaces                    | Primary assertions                                                                  |
| ------- | -------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| E2E-P01 | Lead to client, package, tenant provisioning and owner activation    | Platform/API/jobs           | Idempotent/resumable steps, no duplicate tenant/user/domain, audit                  |
| E2E-P02 | Monthly platform billing, partial payment, statement                 | Platform/API/PDF            | Currency separation, optional VAT, allocations, immutable posting                   |
| E2E-P03 | Package change and entitlement limit                                 | Platform/tenant             | Impact preview; only new over-limit action blocked; existing/service data untouched |
| E2E-P04 | Active → grace → restricted → restored                               | Platform/tenant/network     | Guarded/audited state; exports/payments/recovery safe; no subscriber network action |
| E2E-P05 | Support request, independent approval, scoped session, revoke/expire | Both webs/API               | Banner, least privilege, every access audited, no refresh/silent extension          |
| E2E-T01 | Subscriber onboarding and installation activation                    | Tenant/API/network fake     | Scoped auth, package price history, audit and safe activation handoff               |
| E2E-T02 | Recurring billing and retry failed subscribers                       | Tenant/API/jobs             | No duplicates, USD/LBP separate, optional VAT, progress and retry subset            |
| E2E-T03 | Cashier office payment, receipt and linked correction                | Tenant/API/PDF              | Idempotency, allocation, immutable posted chain, Arabic/English receipt             |
| E2E-T04 | Collector handover and per-currency reconciliation                   | Tenant/mobile/API           | Expected/declared/difference per method/currency, approvals and audit               |
| E2E-M01 | Full collector day online                                            | Mobile/API/printer fake     | Assignment scope, payments/visits/receipts, close shift                             |
| E2E-M02 | Full day offline then repeated/out-of-order sync                     | Mobile/API                  | Local durability before success, no duplicate records, recoverable conflicts        |
| E2E-M03 | Printer failure after payment and reprint                            | Mobile/API                  | Posted payment/receipt retained, reprint audited                                    |
| E2E-M04 | Device revoked during offline day                                    | Mobile/API                  | No new assignment/read/sync; safe local lock/expiry; recovery instructions          |
| E2E-N01 | PPPoE desired-state job success/failure/timeout/uncertain            | Tenant/API/worker/simulator | Durable attempts, bounded retry, reconcile uncertain, secrets absent                |
| E2E-N02 | Bulk network action preview/approval/cancel                          | Tenant/API/worker           | Scoped targets, step-up/approval, circuit breaker, audit                            |
| E2E-X01 | Public single-document verification                                  | Public/API                  | Opaque token, minimum disclosure, expiry/revoke/rate limit, no portal path          |
| E2E-X02 | Export with malicious cell and cross-tenant attempt                  | Web/API/job/storage         | Permission/audit, formula neutralization, signed tenant object                      |
| E2E-X03 | Provider webhook duplicate/replay/invalid signature                  | Provider fake/API/jobs      | Authenticate before mutation, exactly-once record, quarantine visibility            |
| E2E-R01 | Single-tenant restore and post-restore smoke                         | Recovery/API                | Correct tenant manifest, point-in-time objective, no cross-tenant overwrite         |

Each journey covers permitted and denied roles, desktop/mobile viewport where relevant, English LTR
and Arabic RTL, keyboard/accessibility basics, loading/error/retry states, audit and correlation
IDs. Payment and network journeys also inject request timeout after server commit.
