# Orvex ISP

Production-oriented monorepo for Orvex Solutions and its ISP clients. It contains Orvex ISP Control
Center for Orvex staff, isolated Orvex ISP Operations workspaces for tenant teams, the internal
Orvex ISP Collect application, the Core API, Orvex ISP Network Worker, a MikroTik integration
boundary, and a minimal single-document verifier. Subscribers do not have accounts or a portal.

## Current delivery state

The production product is implemented across Control Center, Tenant Operations, Collect, the Core
API, finance and security audit relays, the Network Worker, provider boundaries, PostgreSQL
migrations, and the release/deployment kit. The production composition is live at:

- `https://isp.mosesgr.com/` — tenant operations
- `https://isp.mosesgr.com/control/` — Orvex Control Center
- `https://isp.mosesgr.com/ready` — dependency readiness

Authenticated production sessions use the composed Control Center, tenant summary, operations,
finance, Collect, and authentication APIs. Development-only views may use records explicitly marked
as demonstration data when no API session is supplied.

External business activation remains deliberately fail-closed: live payment/provider contracts,
RouterOS credentials and lab acceptance, notification delivery, tax/legal policy, and accepted
backup/restore objectives must be supplied by their owners. Phase and acceptance evidence is tracked
in `docs/task-plan-orvex.md`.

## Prerequisites

- Node.js 22.15.0 and npm 11.17.0
- Docker 28+ with Compose v2 for PostgreSQL, Redis, object storage, and local mail

## Start locally

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d
npm run dev
```

Run the web applications in separate terminals with their workspace `dev` scripts. API health is
available at `http://localhost:3000/health`.

## Validate

```powershell
npm run validate
```

Focused scripts are `format:check`, `lint`, `typecheck`, `test`, `build`, and `db:check`. See
`docs/operations/local-development.md` for database setup, seed identities, and troubleshooting.

## Architecture and safety

PostgreSQL is the system of record. Shared hosted deployments use tenant keys at every data boundary
and PostgreSQL row-level security as defense in depth; dedicated and self-hosted variants keep the
same application contracts. Redis is used for short-lived coordination, not authorization truth.
External work is queued and idempotent. Money is stored in integer minor units with an explicit
currency and is never silently converted or combined.

Start with `docs/architecture/overview.md`, `docs/requirements/requirements.md`,
`docs/security/threat-model.md`, and `docs/task-plan.md`.
