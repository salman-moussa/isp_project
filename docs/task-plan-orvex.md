# Orvex ISP continuation task plan

Status values: `Pending`, `In progress`, `Blocked`, `Verified`.

| Gate | Work                                                     | Owner                           | Dependencies      | Evidence required                           | Status      |
| ---- | -------------------------------------------------------- | ------------------------------- | ----------------- | ------------------------------------------- | ----------- |
| A0   | Capture pre-remediation baseline and audit               | Lead + independent audit agents | None              | Commit, commands, audit report              | Verified    |
| A1   | Controlled Orvex product identity migration              | Brand/UX                        | A0                | Scan, focused tests/build, ADR              | Verified    |
| A2   | Runnable compiled API artifact                           | Lead                            | A0                | Ordered build and health smoke              | Verified    |
| A3   | Restricted database roles and migration hardening        | Database                        | A0                | Static checks plus live role proof          | Blocked     |
| A4   | Verified tenant capability and denial-audit repair       | Lead + Database                 | A3                | API and live pool/isolation tests           | In progress |
| A5   | Canonical sessions, permissions, and support grants      | Identity/API                    | A3, A4            | Revocation/narrowing/approval matrix        | In progress |
| A6   | API contracts, OpenAPI, readiness, redaction             | API                             | A4, A5            | Contract and dependency-failure tests       | In progress |
| B1   | Official-source competitive/no-copy research             | UX research                     | A0                | Reviewed research document                  | Verified    |
| B2   | Orvex tokens, component system, Storybook                | Design system                   | A1, B1            | EN/AR stories, a11y/RTL/visual evidence     | Pending     |
| B3   | Secure Control, Operations, and Collect reference routes | Web + Mobile                    | A5, A6, B2        | E2E and independent UX/security review      | Pending     |
| C    | Control Center domains                                   | Control Center team             | Phase B           | Lead-to-live and commercial E2E             | Pending     |
| D    | ISP Operations domains                                   | Operations team                 | Phase B           | Subscriber-to-reconciliation E2E            | Pending     |
| E    | Orvex ISP Collect                                        | Mobile team                     | Phase D contracts | Offline-day fault matrix                    | Pending     |
| F    | Network Worker and provider adapters                     | Network/Integrations            | Phase D contracts | Simulator/provider contract matrix          | Pending     |
| G    | Scale, security, DR, and release candidate               | SRE + QA + Security             | C–F               | Load, DAST, restore, rollback, final review | Pending     |

## File ownership rules for active Gate A work

- Brand/UX: web apps, shared UI, research/UX docs, brand ADR and scan.
- Database: database package, PostgreSQL init, Compose, live-database evidence doc.
- Lead/API: API, contracts/domain, root scripts/config, audit/task documentation.
- No two owners edit the same migration or shared component simultaneously.

## Current external limitations

- Docker Desktop is stopped and the current process cannot start `com.docker.service` without
  administrative access. Live PostgreSQL evidence cannot run until the owner starts Docker Desktop.
- VAT/numbering/retention/rounding policy, commercial catalogue, production hosting/RPO/RTO/KMS,
  live provider contracts, RouterOS lab scope, and printer policy remain owner decisions for later
  gates. These do not block the current remediation work.

## Latest Gate A evidence

- `npm run validate` passed on 2026-08-10 in 500.7 seconds: formatting, all seven workspace lints
  and typechecks, 36 unit/component/contract tests, package/application production builds, the
  157-file brand scan, compiled API smoke, and static database checks.
- The integration command explicitly skipped because runtime/migration DSNs were absent; this is not
  credited as live PostgreSQL evidence.
- The API reference slice now publishes and enforces request/response/error OpenAPI contracts and
  tests framework-level validation envelopes, authorization, canonical support grants, denial audit,
  readiness failure, currency separation, and no-store responses.
- The live harness and CI fixture are prepared for restricted roles, FORCE RLS DML/missing context,
  support narrowing/revocation, append-only audit/security events, pool leakage, fresh migration,
  and prior-schema adoption through the operator bridge.
- The operator bridge checks the target/owner, uses a trusted search path, applies the immutable
  baseline in a transaction-scoped reference schema, compares security-relevant catalogs, rejects a
  pre-existing new-style ledger, records the exact baseline checksum, and transfers only enumerated
  objects. Its SQL behavior still requires the blocked live PostgreSQL run.
