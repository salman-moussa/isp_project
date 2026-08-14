# Load and soak execution plan

## Safety and prerequisites

Run only against an explicitly authorized non-production environment containing synthetic data.
Record artifact digest, commit, schema migration set, host/container limits, PostgreSQL
configuration, pool sizes, data distribution and test-tool version. Enable PII-safe telemetry first.
Confirm backup, abort ownership and a clean baseline. Never reuse live credentials, subscriber data,
provider endpoints, RouterOS devices, OMT, Whish or messaging destinations.

The dependency-free harness in `infra/performance` is useful for S0 HTTP preflight. It is not enough
for finance, offline sync, billing or network correctness; those drivers must use real contracts and
simulators and validate persistent outcomes.

## Increment sequence

1. Warm up for 10 minutes; record caches and connection state.
2. Run 25%, 50%, 75%, then 100% reference traffic for at least 15 minutes each.
3. At each step, capture latency distributions, error classes, CPU/RSS, event-loop lag, DB pool
   wait, connections, locks, WAL, slow queries, relay/queue oldest age and downstream simulator
   latency.
4. Stop increasing on a correctness failure, p95/p99 breach, >70% DB connection budget, sustained
   > 80% memory, swap/oom, pool wait growth, queue age >50% objective, or a monotonic resource
   > trend.
5. Identify and change one bottleneck at a time. Re-run the prior gate before advancing.
6. Run spike/recovery, dependency degradation and process restart after the reference gate passes.
7. Run eight-hour, then 24-hour soak only after shorter gates show stable resources.

## Scenario evidence

| ID               | Driver                                                            | Required correctness evidence                                             |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| PERF-HTTP-001    | Authenticated tenant/control read/write route mix                 | auth denials correct; tenant sentinel scan; request/error/SLO report      |
| PERF-PAY-001     | Concurrent payments with 10% duplicate keys and payload conflicts | one canonical result/key; conflicts rejected; no over-allocation          |
| PERF-BILL-001    | Jittered 5k and 25k subscriber billing runs                       | no duplicate invoice; restart resumes failed chunks only                  |
| PERF-SYNC-001    | Offline batches, reorder, duplicate/reconnect, device revocation  | no lost accepted operation; duplicate result stable; conflicts classified |
| PERF-NET-001     | Simulator slow/offline/unknown routers and worker restart         | one mutation/router; unknown state held; no blind repeat                  |
| PERF-FAIR-001    | noisy tenant plus normal tenants                                  | quotas hold; normal tenant SLO/queue-age stays within objective           |
| PERF-RELAY-001   | relay outage then recovery burst                                  | no audit/state loss; duplicate replay harmless; backlog drains fairly     |
| PERF-SOAK-001    | mixed workload for 8h then 24h                                    | no monotonic RSS/connection/lag growth; invariant scans clean             |
| PERF-RESTORE-001 | backup under reference reads, isolated restore                    | latency impact recorded; checksum/readability/smoke and RPO/RTO measured  |

## Abort and cleanup

The test lead may abort immediately; workload drivers stop new intake and await bounded in-flight
completion. Preserve telemetry and databases for diagnosis before cleanup. Revoke synthetic tokens,
remove temporary object prefixes and record every cleanup action. Do not drop an environment with an
unresolved integrity or isolation failure because it is incident evidence.

## Promotion rule

A report passes only if every declared threshold and business invariant passes. Missing telemetry,
unknown errors, skipped invariant queries, absent raw evidence, or environment drift makes the run
inconclusive. An inconclusive run is never converted to pass by narrative review.
