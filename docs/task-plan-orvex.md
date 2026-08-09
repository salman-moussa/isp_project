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

- Docker Desktop daemon is unavailable, so live PostgreSQL evidence cannot run until it starts.
- VAT/numbering/retention/rounding policy, commercial catalogue, production hosting/RPO/RTO/KMS,
  live provider contracts, RouterOS lab scope, and printer policy remain owner decisions for later
  gates. These do not block the current remediation work.
