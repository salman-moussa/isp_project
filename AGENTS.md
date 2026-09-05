# Engineering Collaboration Guide

## Mission and boundaries

Build Orvex ISP, a secure bilingual operations platform for Lebanese ISPs. Keep Orvex ISP Control
Center, each tenant's Orvex ISP Operations workspace, Orvex ISP Collect, and the public
single-document verifier as separate security surfaces. Orvex Solutions is the vendor name. There is
no subscriber account, portal, or login.

## Repository ownership

- `apps/api`: versioned HTTP API and composition root.
- `apps/platform-web`: Orvex staff-only Orvex ISP Control Center.
- `apps/tenant-web`: tenant Orvex ISP Operations workspace.
- `apps/collect`: internal Orvex ISP Collect application (Expo/React Native).
- `apps/document-verifier`: **not yet created.** Public single-document verification is still
  unimplemented; the surface stays separate from tenant and platform sessions when it lands.
- `packages/contracts`: API schemas, permissions, statuses, and shared identifiers.
- `packages/domain`: framework-free domain rules and state machines.
- `packages/database`: PostgreSQL schema, migrations, repositories, and isolation policies.
- `packages/ui`: shared accessible bilingual UI primitives; never share authorization logic here.
- `workers`: durable billing, integration, and Orvex ISP Network Worker processes.
- `infra`: development and deployment infrastructure.
- `docs`: requirements, ADRs, security, testing, operations, and user guidance.

Coordinate before editing another owner's files. Migration names use UTC timestamps and a short
purpose. Do not rewrite or renumber an applied migration.

Stable internal package scopes such as `@isp/*`, database identifiers, and existing deployment keys
may remain during the controlled identity migration. They are implementation identifiers, never
user-facing product names; ADR-0011 records the compatibility rationale.

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
npm run release:packaging
npm run validate
```

`release:packaging` asserts the committed bytes are deployable: LF-only text blobs, executable
`*.sh`, and forward-only scoped migrations. It exists because a CRLF checkout silently changes an
applied migration's SHA-256 and breaks production deployment mid-flight. Never work around it by
editing `_orvex_migrations`; fix the artifact.

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
