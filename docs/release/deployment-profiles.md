# Deployment profiles and validation gates

All profiles promote the same immutable, non-root, signed/scanned application artifacts. Control and
tenant data planes retain separate database credentials and responsibilities. PostgreSQL, Redis,
object storage, pooler admin, metrics and Collector ports are private. Secrets are runtime
references, never image layers, Compose files or Terraform state values.

## Profile A — starter production

- Hardened single host/small VPS with reverse proxy and TLS; only 80/443 are public.
- Two API processes when the measured memory/connection worksheet permits, otherwise restart-safe
  process management with documented reduced availability.
- Separate audit relay and later workload-specific worker processes with CPU/RSS/database budgets.
- PostgreSQL, Redis and S3-compatible object storage on private/local networks; durable volumes are
  not confused with backups.
- OpenTelemetry Collector/Prometheus scrape endpoints remain private. Encrypted backup is copied
  off-host and independently readable.
- Deploy one artifact digest, run scoped expand-compatible migrations, readiness and smoke, then
  record evidence. Host failure is an accepted availability limitation requiring approved RTO.

Validation: Compose/render validation, port scan, secret/image/SBOM scan, clean bootstrap, two API
restart test, database context/pool-reuse test, worker backlog recovery, backup checksum, isolated
control + tenant + object restore, post-restore smoke and application rollback rehearsal.

## Profile B — high availability/horizontal scale

- Load balancer with multiple stateless API/web instances across failure domains.
- Independently scaled worker groups: finance/billing, documents/import/export, mobile sync,
  integrations, network and relays. Each has tenant fairness, concurrency and downstream guards.
- PgBouncer transaction pooling with measured pool budgets. `SET LOCAL` security context is set only
  inside explicit transactions and pool-reuse isolation is continuously tested.
- Managed/HA PostgreSQL primary, tested backups/PITR and optional reporting replica for named stale-
  tolerant projections only. Redis HA/managed and external S3-compatible storage.
- OpenTelemetry Collector gateways, central metrics/logs/traces, SLOs and drilled alert routing.
- Autoscaling uses CPU/memory plus request concurrency, pool wait and queue oldest age while
  guarding downstream saturation. Kubernetes requires a measured operational ADR; it is not
  mandatory.

Validation adds instance/zone failure, pooler restart, DB failover under accepted work, Redis/broker
restart, object-store degradation, relay replay, noisy-tenant fairness, scaling stability and
restore on replacement infrastructure.

## Profile C — dedicated tenant

- Dedicated tenant database, object namespace/key material and optionally dedicated API/worker
  pools.
- Same API/event contracts and release digest as shared hosted; control-plane commercial state stays
  separate and never gains implicit tenant PII access.
- Controlled export/import with counts/checksums, opaque ID mapping, maintenance window and rollback
  decision point before traffic switch.
- Tenant-specific retention, backup/PITR, restore-test cadence, data residency and upgrade wave.

Validation adds shared-to-dedicated synthetic migration, reconciliation by relation/object counts
and business totals, DNS/TLS switch rehearsal, routing isolation, dedicated restore and
previous-route recovery before writes resume.

## Promotion contract

1. Build once; capture source commit, dependency lock hash, image/artifact digest, SBOM, provenance,
   signature and scan outputs.
2. Verify schema compatibility across current/next application during expand and migrate phases.
3. Copy encrypted backups and verify readability before migration. Never call a local volume a
   backup.
4. Deploy bounded canary/wave, require readiness plus domain smoke and watch the declared bake
   window.
5. Stop the wave on correctness, isolation, error-budget, database/pool or queue-age failure.
6. Application rollback redeploys a schema-compatible prior digest. Database recovery is forward
   repair unless an approved isolated restore/RPO decision accepts loss; never run destructive down
   migration automatically.
7. Contract cleanup ships only after every supported application/worker version has moved forward.

Provider selection, hosting region/budget, launch RPO/RTO/SLOs and the first production profile
remain owner decisions. No profile is “validated” until its listed evidence exists.
