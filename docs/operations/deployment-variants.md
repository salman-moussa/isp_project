# Deployment variants

## Common production baseline

All variants require TLS edge, private application/data/management/monitoring boundaries, separate
control and tenant data, non-root least-privilege workloads, external secrets, encrypted
storage/backups, health probes, structured telemetry, patching, time synchronization, bounded
resources/logs, immutable artifacts and documented rollback.

| Concern       | Shared hosted                                       | Dedicated hosted                                                                  | Self-hosted                                                                              |
| ------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Data topology | Control DB separate; tenant DB per tenant preferred | Dedicated tenant stack/database; control metadata remains vendor-side by contract | Customer-owned tenant stack; only approved aggregate/control metadata leaves site        |
| Scaling       | Pooled stateless services and tenant-aware workers  | Per-client sizing and maintenance                                                 | Published sizing; customer operates or contracts support                                 |
| Isolation     | Strong logical + database/object/network controls   | Additional compute/network account isolation                                      | Customer perimeter plus application controls                                             |
| Releases      | Vendor canary/rolling/blue-green                    | Scheduled per-client channel/window                                               | Signed bundle and operator-run upgrade; no silent access                                 |
| Backups       | Vendor encrypted off-host tiers                     | Client-specific policy/repository                                                 | Data owner chooses repository; export/restore tooling and responsibility matrix required |
| Support       | Approved scoped application session                 | Same, plus infrastructure access separately approved                              | No assumed host access; customer-mediated support and explicit session                   |
| SLO           | Multi-tenant service SLO                            | Contract-specific                                                                 | Product support target; infrastructure SLO owned per contract                            |

## Network boundaries

Public: reverse proxy only. Application: web/API/workers. Data: PostgreSQL/Redis/object endpoints.
Management: deployment, host administration and secret system. Monitoring:
collectors/backends/dashboard access. Backup: write-only workload path and separately authorized
restore path. Deny by default between boundaries and constrain provider/router egress by
destination/port where practical.

## Production preflight

- DNS/TLS ownership, deployment identity and environment classification verified.
- Capacity, storage growth, retention, data residency and accepted SLO/RPO/RTO recorded.
- Secret references resolve without values entering logs; break-glass access works and is audited.
- Database extensions/roles/migrations and tenant/object policies validated with runtime identities.
- Backup target, encryption and restore authorization configured; an isolated restore must be
  completed before launch.
- Monitoring routes reach on-call owners; synthetic health and alert delivery tested.
- Fake/manual/live provider modes are explicit; no unavailable private API is fabricated or silently
  enabled.

The included Terraform/Ansible is a baseline layout, not a turn-key production deployment.
Provider/account-specific modules, remote encrypted state, DNS/TLS, managed data services, secret
manager, image registry and observability backend must be selected and reviewed before production.
