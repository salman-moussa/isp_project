# Orvex ISP continuation task plan

Status values: `Pending`, `In progress`, `Blocked`, `Verified`.

| Gate | Work                                                     | Owner                           | Dependencies      | Evidence required                           | Status      |
| ---- | -------------------------------------------------------- | ------------------------------- | ----------------- | ------------------------------------------- | ----------- |
| A0   | Capture pre-remediation baseline and audit               | Lead + independent audit agents | None              | Commit, commands, audit report              | Verified    |
| A1   | Controlled Orvex product identity migration              | Brand/UX                        | A0                | Scan, focused tests/build, ADR              | Verified    |
| A2   | Runnable compiled API artifact                           | Lead                            | A0                | Ordered build and health smoke              | Verified    |
| A3   | Restricted database roles and migration hardening        | Database                        | A0                | Static checks plus live role proof          | Verified    |
| A4   | Verified tenant capability and denial-audit repair       | Lead + Database                 | A3                | API and live pool/isolation tests           | Verified    |
| A5   | Canonical sessions, permissions, and support grants      | Identity/API                    | A3, A4            | Revocation/narrowing/approval matrix        | Verified    |
| A6   | API contracts, OpenAPI, readiness, redaction             | API                             | A4, A5            | Contract and dependency-failure tests       | Verified    |
| B1   | Official-source competitive/no-copy research             | UX research                     | A0                | Reviewed research document                  | Verified    |
| B2   | Orvex tokens, component system, Storybook                | Design system                   | A1, B1            | EN/AR stories, a11y/RTL/visual evidence     | In progress |
| B3   | Secure Control, Operations, and Collect reference routes | Web + Mobile                    | A5, A6, B2        | E2E and independent UX/security review      | In progress |
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

## Current external inputs

- VAT/numbering/retention/rounding policy, commercial catalogue, production hosting/RPO/RTO/KMS,
  live provider contracts, RouterOS lab scope, and printer policy remain owner decisions for later
  gates. They do not invalidate the completed foundation safety gate, but production activation
  cannot be accepted without them.

## Latest foundation evidence

- The 2026-08-11 aggregate gate passed formatting, lint and strict type checks across eight
  workspaces; 15 test files with 76 unit/component/contract tests; every package, application and
  worker production build; the 218-file brand scan; compiled API smoke; schema safety; Compose
  parsing; and `git diff --check`.
- The production dependency audit reported zero vulnerabilities. Four moderate findings remain only
  in the Drizzle Kit development toolchain through an old `esbuild`, with no available upstream fix;
  it is not included in production dependencies or artifacts.
- A fresh isolated PostgreSQL 18 gate passed the roles-only 1530→1700 upgrade while preserving
  pending and delivered audit evidence; empty and prior-schema migrations; restricted-role and
  FORCE-RLS isolation; transaction-local pool cleanup; immutable finance; USD/LBP and exact
  idempotency rules; deterministic allocation/reversal races; atomic finance outbox rollback; and
  separate-plane retry/deduplication/API conflict mapping.
- The finance audit relay discovers pending tenant databases, drains bounded batches with retry and
  backlog readiness, preserves the complete authorized request envelope, and uses an event identity
  that cannot collide with ambiguous HTTP-failure evidence. Its hardened non-root, read-only image
  passed container smoke and graceful-shutdown checks.
- Independent database/security and Phase-B web reviews reported no unresolved critical, high or
  medium issue in the implemented foundation. The bilingual reference web routes, shared tokens, RTL
  preservation, mobile drawer containment, deep links and accessibility tests pass; Storybook,
  browser/assistive-technology visual evidence and the Collect reference flow remain Phase-B work.
