# Orvex ISP foundation audit — 2026-08-09

Status: Remediation in progress. This report records the pre-remediation baseline at commit
`814c476`; it is not release evidence.

## Baseline evidence

- Repository: empty upstream, local `main`, no pre-existing commits.
- Baseline checkpoint: `814c476 chore: checkpoint existing phase 0-2 foundation`.
- Inventory: 147 non-generated files before audit additions.
- `npm run validate`: passed formatting, lint, type checks, 19 tests, workspace builds, and the
  static database safety check.
- Both Compose files parsed using `.env.example`.
- Docker CLI is installed, but the Docker Desktop Linux daemon was unavailable; no container or live
  PostgreSQL result is credited.

The 19 tests were seven mocked API tests, five jsdom shell tests, two contract tests, two SQL-text
tests, and three domain tests. No test connected to PostgreSQL.

## Release-blocking findings

| ID       | Finding                                                                                                          | Baseline evidence                                                                  | Required proof to close                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| FA-P0-01 | Compiled API imported TypeScript source from internal packages.                                                  | Package exports referenced `src`; `node apps/api/dist/server.js` failed on `.ts`.  | Conditional production exports, ordered build, compiled-artifact health smoke.                   |
| FA-P0-02 | API/local/test DSNs used PostgreSQL bootstrap superusers and table owners, bypassing RLS.                        | Compose `POSTGRES_USER` was also the runtime user; no restricted roles existed.    | Non-owner `NOSUPERUSER NOBYPASSRLS` roles and live catalog/behavior tests.                       |
| FA-P0-03 | Tenant repositories accepted arbitrary strings; denial auditing could write into an attacker-selected tenant.    | URL tenant ID flowed to transaction GUC and denied event tenant.                   | UUID validation, verified tenant capability, actor-scoped denial audit, live cross-tenant tests. |
| FA-P0-04 | Support authorization trusted claim permissions without proving they still matched the canonical approved grant. | Database lookup returned only a boolean; authorization used claim permissions.     | Canonical scope/version/approver/nonce resolution and revocation/narrowing tests.                |
| FA-P0-05 | No executable PostgreSQL migration/RLS/audit/concurrency gate existed.                                           | Database checks searched SQL strings; CI integration job was optional and skipped. | Mandatory live integration suite using real restricted runtime credentials.                      |

## High-priority architecture findings

- One mixed database/schema contradicted the proposed control-plane and tenant-plane separation.
- Web authentication used bearer JWT claims while ADR-0003 proposed opaque cookie sessions; the
  discrepancy must be resolved before accepting the ADR.
- The sole business API route had no authoritative Fastify/OpenAPI request and response schema.
- `/ready` did not verify dependencies.
- Platform and tenant web applications were static demonstrations: no router, API client,
  permissions, real support session, or record routes.
- UI fixtures were labelled `Live`/`Production`; search, account, and placeholder actions were dead.
- Required mobile, document-verifier, worker, provider, observability, queue, and outbox workspaces
  did not exist.
- CI contained optional/empty integration and container gates; there were no Dockerfiles.
- Terraform and monitoring were declared scaffolds, not executable deployment/telemetry evidence.

## UI and accessibility findings

- Visible identity remained Cedar Ops/legacy product names rather than Orvex ISP.
- Control Center and Operations reused one generic KPI-card composition instead of distinct tasks.
- Axe color-contrast checks were disabled; two essential text colors failed normal-text contrast.
- The mobile navigation lacked a focus boundary, Escape handling, inert background, and restoration.
- Static support access started active and “revocation” only hid client state.
- Translation objects mixed localized copy with domain data; bidi identifiers and remaining English
  labels were not isolated or translated.

## Documentation and traceability truth

All 98 catalogue requirements remained `Planned`, which is accurate. Ten ADRs remained `Proposed`.
No requirement should be promoted to `Verified` until implementation links, executable evidence, and
independent review are recorded. README and architecture claims must remain qualified while the
blockers above are open.

## Remediation order

1. Preserve the baseline and make compiled artifacts runnable.
2. Establish restricted database roles, migration history, and separate control/tenant pools.
3. Introduce verified tenant capabilities and correct denial-audit routing.
4. Resolve canonical session, permission, and support-grant authorization.
5. Standardize API contracts, readiness, errors, logging, and OpenAPI.
6. Complete the Orvex identity migration and automated brand scan.
7. Add official-source research, design system, and secure reference routes.
8. Begin business domains only after the live PostgreSQL safety gate passes.

## Independent audit boundaries

The foundation, database/tenancy, and UX/research audits were performed independently and read-only.
They did not author the remediations they recommended.
