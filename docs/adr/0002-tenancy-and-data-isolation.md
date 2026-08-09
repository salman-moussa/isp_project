# ADR-0002: Separate control plane and RLS-isolated shared tenant data plane

- Status: Proposed
- Date: 2026-08-09
- Deciders: Architecture, Security, Data, SRE
- Requirements: PRD-BND-004..005, PRD-SEC-001, PRD-IAM-008, PRD-OPS-006
- Risks: RSK-001, RSK-004, RSK-012, RSK-016

## Context

Platform operators need commercial and aggregate health visibility but must not silently browse
Subscriber PII. Tenants require strong separation, tenant-level backup/export/restore and
shared/dedicated/self-hosted deployment. Isolation must extend beyond rows to jobs, cache, files,
realtime, telemetry and support access.

## Decision

Use a dedicated logical/physical control-plane PostgreSQL database and, for the reference
shared-hosted topology, a separate shared tenant-data PostgreSQL database containing tenant
operational tables. Every tenant row has a non-null `tenant_id`; PostgreSQL `ENABLE` and
`FORCE ROW LEVEL SECURITY` policies use a transaction-local verified tenant setting. The application
runtime role has neither `BYPASSRLS` nor table-owner bypass, and no general runtime role may disable
policies. Dedicated/self-hosted deployments preserve the same contracts but may assign one database
per tenant. Control data stores the tenant/deployment registry and allowed aggregate telemetry,
never raw tenant operations.

Establish `VerifiedTenantContext` only from server-controlled deployment/host resolution plus
authenticated membership or an approved support capability. `inTenantTransaction` sets
`app.tenant_id` transaction-locally before any tenant query; repositories accept the scoped
transaction/capability, not an arbitrary tenant string or unscoped connection. Queue handlers,
cache/file/realtime/export/backup adapters require the same context. No cross-tenant or
control-to-tenant database join/transaction is permitted. Cross-plane communication uses versioned
minimal events/commands and allowlisted aggregates.

Support access is the sole interactive cross-boundary path and is governed by ADR-0003. Each
plane/tenant has scoped object namespaces, keys/topics, backup manifests and audit. Scheduled/fleet
work fans out to one isolated job per tenant and clears connection/context between jobs.

## Consequences

- RLS gives database-enforced shared-hosted separation and efficient connection/migration
  operations, but a shared database increases blast radius and noisy-neighbor risk compared with
  database-per-tenant.
- Tenant-level restore/export requires tested logical/PITR extraction plus object manifests;
  high-risk or large tenants may move to dedicated placement without changing contracts.
- Fleet analytics must use explicit privacy-reviewed projections rather than convenient joins.
- RLS policy coverage, non-bypass runtime roles, transaction-local context cleanup and query plans
  become mandatory database fitness functions.

## Rejected alternatives

- Shared schema with application `tenant_id` filters but no forced RLS: insufficient defense in
  depth.
- Database per tenant as the shared-hosted default: strongest placement isolation, but rejected
  initially due fleet connection/migration/backup operational cost; retained for
  dedicated/self-hosted placement.
- Schema-per-tenant in one DB: high migration/search-path complexity while retaining shared blast
  radius.
- Platform superuser direct tenant connections: violates explicit support-access boundary.

## Validation

`T-ISO-ALL-001` covers API, DB, job, cache, file, realtime, export, backup and log boundaries;
direct SQL tests prove FORCE RLS, no runtime bypass and missing/wrong context denial; forged
host/header/path/body/queue scope tests; pooled-connection transaction cleanup/leak tests; logical
one-tenant restore into isolation; aggregate PII/small-cell review; architecture rule prevents
unscoped tenant repository construction.
