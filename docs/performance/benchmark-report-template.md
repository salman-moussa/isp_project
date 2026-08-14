# Performance report — TEMPLATE / NOT EXECUTED

- Evidence ID:
- Date and operator:
- Authorization/change reference:
- Commit and immutable artifact digest:
- Scenario/config hash and tool version:
- Environment profile and exact topology:
- CPU/memory/disk/network limits:
- PostgreSQL version/config/pool limits/data and index bytes:
- Synthetic dataset distribution:
- Monitoring/evidence time range:

## Workload and acceptance

Record route/command mix, ramp, duration, concurrency, request rate, background work, dependency
latency/faults and explicit thresholds before execution.

## Results

| Signal                   | Threshold | Measured | Pass/fail | Evidence link |
| ------------------------ | --------- | -------- | --------- | ------------- |
| Throughput               |           |          |           |               |
| Read p50/p95/p99/max     |           |          |           |               |
| Write p50/p95/p99/max    |           |          |           |               |
| Error rate by class      |           |          |           |               |
| DB pool wait/utilization |           |          |           |               |
| Queue/relay oldest age   |           |          |           |               |
| CPU/RSS/event-loop lag   |           |          |           |               |
| Lock/WAL/storage growth  |           |          |           |               |
| Billing/network duration |           |          |           |               |

## Correctness and isolation

- Tenant sentinel scan:
- Payment/idempotency invariant queries:
- Invoice duplicate/numbering checks:
- Mobile accepted/lost/duplicate/conflict reconciliation:
- Network unknown-outcome and ordering reconciliation:
- Audit/outbox source-to-destination counts:
- Telemetry PII/secret sentinel scan:

## Bottleneck, changes and residual risk

State the first bottleneck with supporting evidence, one-at-a-time tuning changes, rerun comparison,
unresolved gaps and the next safe increment. Attach raw harness JSON, monitoring export, sanitized
query plans, logs, configuration and checksums. Until every field is populated from an executed run,
this document remains a template and provides no capacity claim.
