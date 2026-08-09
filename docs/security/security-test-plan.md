# Security test plan

This plan defines release evidence. It does not claim that any test has run.

## Gates and severity

Critical/high findings block staging promotion or production release. Medium findings require
triage, an owner and deadline; production acceptance also requires an authorized, time-bounded risk
decision. Tests must fail closed. Informational jobs may be non-blocking only when explicitly
labelled and excluded from gate evidence.

| Suite                     | Coverage                                                                               | Environment            | Gate / cadence                                  |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| Authorization matrix      | Roles, scopes, object/field actions, approvals, self-approval denial                   | Integration            | Every merge                                     |
| Tenant isolation          | API, DB, job, cache, lock, files, realtime, exports, backups, telemetry                | Integration/staging    | Every merge for core; full before release       |
| Auth/session/device abuse | Enumeration, recovery, MFA, fixation, CSRF, refresh reuse, revoke, expiry              | Integration/E2E        | Every merge                                     |
| Support access            | Approval, scope, banner, audit, expiry, revocation, token non-refreshability           | E2E                    | Every merge                                     |
| Financial integrity       | Replay/concurrency, immutability, corrections, USD/LBP, formula export                 | DB/API/property/E2E    | Every merge                                     |
| Mobile                    | Encrypted persistence, offline replay, conflicts, revoked/stolen device                | Mobile integration/E2E | Every release                                   |
| Upload/public verifier    | MIME/polyglot/bomb/path/malware, signed URLs, opaque-token disclosure/rate             | Integration/DAST       | Every release                                   |
| Webhook/provider          | Signature, raw-body, skew, replay, duplication, ordering, unknown event                | Contract/integration   | Every merge                                     |
| Network worker            | Allowlist, auth failure, timeout, uncertain result, safe retry/reconcile, secret leaks | Simulator/integration  | Every merge                                     |
| Static/supply chain       | Secret scan, SAST, dependency, IaC, container, license, SBOM                           | CI                     | Every merge/release                             |
| Dynamic                   | OWASP/API scan plus business-logic cases                                               | Isolated staging       | Before production                               |
| Recovery                  | Backup confidentiality, wrong-tenant prevention, restore authorization/audit           | Isolated restore       | Quarterly and before initial launch             |
| Manual assessment         | Threat-driven code review and penetration test                                         | Staging                | Before initial launch and major boundary change |

## Required negative cases

Each authorization and tenant-isolation case uses at least Tenant A, Tenant B, platform operator
without support, approved scoped support, expired/revoked support, privileged tenant actor,
restricted actor, and anonymous actor. Exercise valid IDs to avoid mistaking `404` due to absent
fixtures for authorization. Test direct database policies using the actual runtime role.

Replay cases send the same key/body, same key/different body, different tenant/same key,
simultaneous requests, retry after timeout, and worker redelivery. File cases include double
extensions, mismatched magic bytes, SVG/script, archive traversal, excessive compression, oversized
images/metadata, EICAR in an isolated scanner test, signed-link expiry and cross-prefix access.

## Tooling policy

- SAST and dependency tooling must understand TypeScript/JavaScript and every additional backend
  language introduced.
- Secret scanning includes history where CI fetch depth permits; verified findings are rotated, not
  merely deleted.
- DAST targets only the authorized isolated staging URL and seeded synthetic data. Destructive
  modules and external live providers stay disabled.
- Container findings use a documented severity/fix-availability policy. Suppressions identify CVE,
  affected component, rationale, compensating control, owner and expiry.
- Test artifacts must not contain tokens, raw PII, payment proofs, router exports, or production
  data.

## Evidence record

For each execution capture UTC time, commit/artifact digest, environment, tool and ruleset version,
command/config, sanitized output, failures, remediation link, approver, and retention location. A
workflow success badge alone is insufficient. Restore and penetration-test evidence must explicitly
state scope and limitations.
