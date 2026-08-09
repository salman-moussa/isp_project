# ADR-0009: Deployment topologies and release strategy

- Status: Proposed
- Date: 2026-08-09
- Deciders: SRE, Architecture, Security, Product Owner
- Requirements: PRD-CTL-011, PRD-OPS-001..006
- Risks: RSK-015, RSK-016, RSK-019

## Context

The product must support shared-hosted, dedicated-hosted and self-hosted modes, fleet database
migrations, backups/restore and idempotent provisioning. Production providers/budgets are
unresolved. Operational complexity must match actual scale.

## Decision

Package stateless web/API and isolated worker processes as non-root, scanned, versioned containers.
Use provider-neutral IaC/configuration for public edge, application, data, monitoring and management
networks. PostgreSQL, Redis and object storage remain private; secrets are external runtime
references. Start with the simplest reliable container orchestration supported by the chosen
provider; Kubernetes requires a later measured ADR.

Shared hosted uses shared stateless pools and a shared tenant-data database with forced RLS,
explicit tenant keys, scoped object namespaces and fairness quotas; the control-plane database
remains separate. Dedicated hosted isolates tenant workloads/data in dedicated database/storage
placement. Self-hosted runs tenant data-plane components under a documented support matrix and uses
outbound authenticated aggregate/update channels; vendor control never gains implicit raw access.

Build once and promote the same immutable signed/scanned artifact through staging to production.
Deploy uses readiness/prechecks, compatibility manifest, backup, maintenance policy, bounded tenant
waves, smoke and explicit approval. Database changes use expand/backfill/switch/contract; never
automatically reverse a migration if new data could be destroyed. Application rollback targets a
schema-compatible prior artifact; repair/forward migration is planned separately.

Provisioning/deployment steps persist deterministic resource keys and status, are
resumable/idempotent and expose redacted logs. Backups are encrypted, off-host where permitted,
checksummed and tested by isolated control/one-tenant/full/object restore exercises.

## Consequences

- Portability and clear topology differences without lowest-common-denominator security.
- Fleet version skew and self-hosted support need compatibility windows, health reporting and
  release channels.
- Backward-compatible migrations take multiple releases/storage but make rolling/wave deployment
  safe.
- Exact topology/RPO/RTO depends on DEC-004/009 and must be costed/approved.

## Rejected alternatives

- Mutable in-place server builds: unreproducible and weak rollback.
- Automatic destructive down migration: risks new data loss.
- One database mixing control-plane commercial records with raw tenant operational data: conflicts
  with ADR-0002.
- Kubernetes for appearance: unjustified until measured needs.
- Vendor inbound tunnel to self-hosted data by default: violates support/privacy boundary.

## Validation

Clean local bootstrap; IaC policy/secret/container scans; retry provisioning at every step; staging
promote/smoke/rollback; expand/contract compatibility test; failed tenant migration stops wave
safely; backup checksum and isolated control/tenant/full/object restore; shared fairness/load and
self-hosted upgrade simulation.
