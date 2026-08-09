# Engineering Collaboration Guide

## Mission and boundaries

Build a secure bilingual operations platform for Lebanese ISPs. Keep the Platform Control Center,
each tenant ISP Workspace, the Collector app, and the public single-document verifier as separate
security surfaces. There is no subscriber account, portal, or login.

## Repository ownership

- `apps/api`: versioned HTTP API and composition root.
- `apps/platform-web`: vendor-only Control Center.
- `apps/tenant-web`: tenant ISP Operations Workspace.
- `apps/collector-mobile`: internal collector application.
- `apps/document-verifier`: public single-document verification only.
- `packages/contracts`: API schemas, permissions, statuses, and shared identifiers.
- `packages/domain`: framework-free domain rules and state machines.
- `packages/database`: PostgreSQL schema, migrations, repositories, and isolation policies.
- `packages/ui`: shared accessible bilingual UI primitives; never share authorization logic here.
- `workers`: durable billing, integration, and MikroTik workers.
- `infra`: development and deployment infrastructure.
- `docs`: requirements, ADRs, security, testing, operations, and user guidance.

Coordinate before editing another owner's files. Migration names use UTC timestamps and a short
purpose. Do not rewrite or renumber an applied migration.

## Required invariants

1. Tenant context comes from a verified session or platform support grant, never from an untrusted
   request header alone.
2. Authorization uses the permission catalogue and scopes; do not scatter role-name checks.
3. Deny by default. Platform roles do not implicitly grant tenant data access.
4. Support access is approved, scoped, short-lived, visible, revocable, and fully audited.
5. Store money as integer minor units plus an ISO currency. Never sum USD and LBP without an
   explicit recorded conversion basis.
6. Posted financial records are append-only and corrected with linked reversals or notes.
7. Mutating external, payment, billing, sync, and network operations require an idempotency key.
8. A platform subscription state must never initiate subscriber network suspension.
9. Secrets are references to a secret store; never log or persist plaintext integration credentials.
10. Every user-facing string must have English and Arabic translations, and layouts must work in LTR
    and RTL.

## Commands

Run from the repository root:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run db:check
npm run validate
```

Use `docker compose up -d` for local dependencies after copying `.env.example` to `.env`. Tests must
not require live OMT, Whish, MikroTik, mapping, message, or payment credentials; use fakes and the
MikroTik simulator.

## Change completion

- Link behavior to a requirement ID and appropriate test.
- Include loading, empty, validation, denial, retry, error, success, and audit states where
  applicable.
- Add authorization, tenant-isolation, and idempotency tests proportional to risk.
- Run focused tests while working and the integrated validation suite at phase gates.
- Record migrations, deployment impact, rollback limits, observability, and residual risk.
- Do not claim a build, test, scan, deployment, backup, restore, or review passed without captured
  execution evidence.

## Review handoff

Handoffs state scope, exclusions, inputs/contracts, files changed, commands actually run, results,
security/tenancy risks, unresolved decisions, and the next owner. Critical financial,
tenant-isolation, support-access, mobile-sync, and network-automation features require an
independent reviewer.
