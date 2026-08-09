# Backup, restore and disaster recovery

Status: policy proposal. RPO/RTO are not accepted and no restore has been executed merely because
this document exists.

## Proposed objectives for owner approval

| Scope                       |                                   Proposed RPO |            Proposed RTO | Method                                                    |
| --------------------------- | ---------------------------------------------: | ----------------------: | --------------------------------------------------------- |
| Control plane and audit     |                                         15 min |                     4 h | Continuous WAL/PITR plus daily full; immutable audit copy |
| Tenant operational database |                                         15 min | 4 h per priority tenant | Per-tenant PITR/full with manifest                        |
| Object storage              | 24 h (or versioning-near-zero where supported) |                     8 h | Versioning/replication plus inventory                     |
| Redis                       |              No authoritative-data loss target |                     1 h | Rebuild caches; durable queue design per adapter          |
| Full hosted environment     |                        15 min DB / 24 h object |                    12 h | IaC rebuild plus data/object recovery                     |

Product owner, deployment owner and affected ISP client policy must accept or revise these targets.
Dedicated/self-hosted contracts may differ.

## Backup design

- Encrypt in transit and at rest with a backup-specific key and identity. Workloads can write but
  cannot delete prior backups; restore operators are separate and dual-approved.
- Keep local short-term recovery plus off-host/off-site copies where contract and data residency
  permit. Proposed retention: 7 daily, 5 weekly, 12 monthly and contractual/legal annual tiers.
- Each backup has an immutable manifest: environment, control/tenant identity, database/object
  scope, schema/app version, start/end, consistency point, encryption-key reference, checksums,
  size, tool version and outcome.
- Back up control DB, every tenant DB, object versions/inventory, audit evidence, IaC/configuration
  (not secret values), release metadata and recovery dependencies. Treat Redis/cache as
  reconstructible unless a queue design explicitly requires persistence.
- Monitor missed windows, size anomalies, verification/checksum failure, replication lag, capacity,
  key access and overdue restore exercises.

## Restore safety

Default to an isolated target, never an in-place overwrite. Verify environment and tenant IDs from
signed/immutable manifests, requested point in time, approver, encryption access, application/schema
compatibility and available capacity. Restore database and objects, run
integrity/isolation/audit/smoke checks, reconcile the requested scope, and only then plan a
separately approved cutover.

Required exercises: control plane, one tenant, full environment and individual object/version. Run
quarterly and after major topology/backup-tool changes; initial production launch requires at least
one successful controlled exercise. Record actual RPO/RTO, gaps and remediation. Sanitized evidence
must not expose backup locations, keys or PII.

## Disaster recovery sequence

1. Declare incident, incident commander, communications and recovery objective; freeze destructive
   automation.
2. Determine last known-good data and whether security compromise requires clean identities/keys.
3. Provision clean infrastructure from reviewed IaC in the approved region/account.
4. Restore control, tenant and object scope to isolated endpoints; validate manifests and checksums.
5. Deploy the exact compatible artifact; run migrations only under the recorded recovery plan.
6. Run tenant-isolation, authentication, finance balance, object, queue and network-safety smoke
   checks.
7. Rotate exposed credentials, update DNS/traffic with rollback point, monitor and communicate.
8. Reconcile delayed webhooks/mobile/network jobs without blind replay; preserve uncertain states.
9. Close only after business owners validate integrity and a post-incident review assigns actions.

Execution steps and evidence fields are in `runbooks/backup-restore.md`.
