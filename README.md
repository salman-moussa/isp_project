# Lebanon ISP Operations Platform

Production-oriented monorepo for Salman Moussa's Team and its ISP clients. It contains a private
Platform Control Center, isolated ISP Operations Workspaces, an internal Collector app, API and
workers, a MikroTik integration boundary, and a minimal single-document verifier. Subscribers do not
have accounts or a portal.

## Current delivery state

The repository is being built in dependency-aware phases. The first executable slice establishes
verified identity, server-resolved tenant context, permission checks, immutable audit records, and
separate bilingual platform and tenant shells. The requirements traceability matrix distinguishes
implemented evidence from planned work; this README does not imply final acceptance.

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
