# Observability, SLOs and alerts

## Telemetry contract

Use OpenTelemetry-compatible traces, metrics and structured JSON logs with UTC timestamp, service,
version, environment, request/trace ID, route template, outcome and duration. Tenant correlation is
a stable pseudonymous/opaque identifier; never emit tenant names, subscriber PII, tokens, cookies,
passwords, payment proofs, object signed URLs, router credentials/exports or raw webhook bodies.

Bound metric labels: route template rather than URL, status class rather than message, stable
job/provider/failure enums, and no subscriber/document/request IDs. Audit records are distinct from
diagnostic logs and have stricter integrity/access/retention.

## Provisional SLOs

Targets require owner approval and a measurement baseline. Planned maintenance and explicitly
excluded external-provider time must be reported separately, not silently removed.

| SLI                                 | Initial objective / window                      | Notes                                                |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Authenticated core API availability | 99.9% successful eligible requests / 30d        | Exclude caller 4xx; include application 5xx/timeouts |
| Normal read latency                 | 95% < 400 ms / 30d                              | Server latency; provider calls separate              |
| Financial write integrity           | 100% no duplicate/cross-currency/partial commit | Correctness SLO; any breach is incident              |
| Payment/sync processing             | 99% accepted operations terminal within 60 s    | Per priority class                                   |
| Routine queue start                 | 99% < 30 s / 30d                                | Bulk/network/provider classes separate               |
| Network job durability              | 100% accepted jobs survive worker restart       | Uncertain result may await reconciliation            |
| Backup success                      | 100% scheduled backups complete and verify      | Restore exercise is a separate control               |
| Restore exercise                    | Accepted RPO/RTO met at scheduled cadence       | No target accepted yet                               |

Use multi-window burn-rate alerts for availability/latency SLOs, plus direct integrity/security
alerts. Dashboards show traffic, errors, duration, saturation; queue depth/oldest age/retries/DLQ;
billing/payment/webhook/sync/network job outcomes; DB locks/connections/slow queries/storage;
object/scanner state; deployment/version/TLS/domain; backup/restore; authentication, support and
fraud-rule events.

## Alert catalogue

| Alert                       | Severity / trigger (initial)                             | Owner                         | Runbook                             |
| --------------------------- | -------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| FinancialIntegrityViolation | SEV-1, any duplicate/imbalanced/cross-currency invariant | App + finance                 | `runbooks/payment-integrity.md`     |
| TenantIsolationSuspected    | SEV-1, any trusted isolation signal                      | Security + incident commander | `runbooks/data-isolation.md`        |
| APIErrorBudgetFastBurn      | SEV-2, 14.4x burn 5m and 1h                              | App on-call                   | `runbooks/service-outage.md`        |
| APIErrorBudgetSlowBurn      | SEV-3, 2x burn 6h and 3d                                 | App owner                     | `runbooks/service-outage.md`        |
| QueueOldestAgeHigh          | SEV-2, priority age > 2m for 10m                         | Worker owner                  | `runbooks/service-outage.md`        |
| DeadLetterCreated           | SEV-2 finance/network; SEV-3 routine                     | Domain owner                  | Service-specific procedure          |
| SupportAccessAbuse          | SEV-1/2, invalid/revoked scope or repeated denials       | Security                      | `runbooks/data-isolation.md`        |
| MikroTikUncertainSpike      | SEV-2, >5 uncertain outcomes/10m or affected bulk batch  | Network                       | `runbooks/mikrotik-failure.md`      |
| BackupFailed                | SEV-2, scheduled backup/verification misses window       | SRE                           | `runbooks/backup-restore.md`        |
| RestoreTestOverdue          | SEV-2 after accepted cadence                             | SRE + owner                   | `runbooks/backup-restore.md`        |
| CredentialCompromiseSignal  | SEV-1, confirmed leak/use                                | Security                      | `runbooks/credential-compromise.md` |
| DiskOrDBSaturation          | SEV-2, forecast <72h or critical resource >85% sustained | SRE                           | `runbooks/service-outage.md`        |

Alerts include environment, affected service/scope, start time, threshold/current value,
trace/dashboard and runbook links. They deduplicate by service/environment/cause, inhibit symptom
alerts during a declared root incident, and route to a tested on-call destination. Notification
delivery itself is monitored.
