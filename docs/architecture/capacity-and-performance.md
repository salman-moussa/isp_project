# Capacity, performance, and reliability assumptions

Status: Initial engineering baseline; validate by measurement before production.  
Related requirements: `PRD-NFR-*`, `PRD-OPS-005`, `PRD-OPS-006`  
Reviewers: Architecture, SRE, QA/Performance, Finance and Network owners

## Profiles

| Dimension                                     | Small tenant | Reference tenant | Large supported tenant |     Shared-hosted reference fleet |
| --------------------------------------------- | -----------: | ---------------: | ---------------------: | --------------------------------: |
| Subscribers                                   |          500 |            5,000 |                 25,000 | 100 tenants / 300,000 subscribers |
| Branches / areas / routes                     |   2 / 10 / 5 |     10 / 75 / 25 |         50 / 300 / 100 |               800 / 6,000 / 2,000 |
| Staff / concurrent web users                  |       15 / 5 |         100 / 30 |              400 / 100 |                  5,000 / 800 peak |
| Collectors / concurrently syncing             |        5 / 3 |          30 / 20 |               120 / 75 |                  2,000 / 500 peak |
| MikroTik routers / simultaneously active jobs |        2 / 1 |           20 / 8 |               100 / 30 |  1,500 / 250, with per-router cap |
| Monthly invoices                              |          600 |            6,000 |                 30,000 |                           400,000 |
| Monthly payments / peak per minute            |      500 / 5 |       5,000 / 30 |           25,000 / 100 |                     350,000 / 500 |
| Network jobs per day                          |          100 |            2,000 |                 15,000 |                           100,000 |
| New attachment data per month                 |         2 GB |            20 GB |                 100 GB |       1 TB before retention/tiers |
| Offline operations per device/day             |           50 |              200 |                    500 |                     250,000 total |

The load-release reference is the **Reference tenant** plus a mixed **Shared-hosted fleet**
workload. The large profile is a design ceiling to test query/queue behavior, not a contractual
entitlement. Above it, capacity review may assign dedicated pools/deployment without changing
product semantics.

## Traffic and workload assumptions

- Peak authenticated read traffic is 10× the daily average during office opening, due-list
  preparation and end-of-day closing; write traffic is 5× average.
- Monthly billing starts are tenant-scheduled with jitter and fleet concurrency controls; never
  enqueue all tenants at midnight Beirut time.
- Each recurring invoice averages 4 lines; each payment averages 1.4 allocations; 10% of payments
  include proof and 20% produce server PDF immediately while the rest render on demand.
- Mobile bootstrap for a reference collector contains at most 500 assigned Subscriber summaries and
  uses pagination/delta sync. Proof media uploads outside the transactional sync payload.
- Router observations are sampled by importance and capability. Do not continuously sample
  per-subscriber bandwidth for all 300,000 fleet subscribers; default active-session refresh is 60
  seconds where supported and router health 30 seconds, with backoff when offline.
- Dashboard projections update within one minute for routine aggregates and within five seconds for
  payment/job progress. Canonical drill-downs remain authoritative and expose projection freshness.
- Exports, imports, PDFs, bulk billing, backup/restore and bulk network actions are asynchronous.
  Interactive request workers do not perform them inline.

## Service objectives

Targets exclude a documented unavailable external provider from core API latency but include adapter
queue/acknowledgement time. These are objectives, not claims until production telemetry exists.

| Service level indicator               | Objective / budget                                                                                                     | Measurement                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Normal authenticated read API latency | p95 ≤400 ms, p99 ≤1,000 ms at reference load; <1% 5xx                                                                  | Edge-to-response histograms by route class, excluding health and streaming.   |
| Financial posting API                 | p95 ≤750 ms for DB commit/ack; 99.9% successful for valid requests; no duplicate/lost writes                           | Request and canonical transaction outcome correlated by idempotency key hash. |
| Interactive acknowledgement           | UI feedback ≤100 ms; loading/progress for longer work                                                                  | RUM and automated interaction timing.                                         |
| Mobile local commit                   | p95 ≤200 ms; success only after encrypted durable transaction                                                          | Device instrumentation without financial/PII payload.                         |
| Mobile sync                           | 95% accepted operations reflected server-side within 60 s when online; 99% within 5 min excluding classified conflicts | Outbox age histograms by non-sensitive status.                                |
| Billing run                           | Reference tenant completes 5,000 invoices within 15 min; duplicates = 0                                                | Run duration, throughput, failed/retried counts and invariant queries.        |
| Network job acknowledgement           | 99% queued within 2 s; execution SLO varies by router, default 95% terminal/reconciliation state within 2 min          | Queue delay + attempt/result metrics by operation/router class.               |
| Dashboard freshness                   | Payments/jobs ≤5 s; financial aggregates ≤60 s; fleet health ≤5 min                                                    | Projection watermark.                                                         |
| Availability                          | Initial 99.9% monthly authenticated API objective                                                                      | Good events / valid total events; maintenance policy pending DEC-009.         |
| Backup/restore                        | Initial DB RPO ≤15 min, RTO ≤4 h; objects RPO ≤24 h, RTO ≤8 h                                                          | Scheduled isolated restore exercises; pending owner acceptance.               |

Correctness beats latency. When a write cannot safely determine outcome, return a stable
pending/reconciliation result with request ID instead of guessing or retrying destructively.

## Latency budget for normal read

| Segment                                      | p95 budget |
| -------------------------------------------- | ---------: |
| Edge/TLS/routing                             |      40 ms |
| Authentication, tenant resolution and policy |      35 ms |
| Application/query service                    |      40 ms |
| PostgreSQL query/connection                  |     180 ms |
| Serialization/compression                    |      35 ms |
| Network reserve                              |      70 ms |
| Total                                        |     400 ms |

Remote client internet latency outside the service edge is measured separately. External providers
are never called synchronously for ordinary list/detail reads.

## Query and payload budgets

- List routes default to 25 and cap at 100 records; mobile delta pages cap by both count and 1 MiB
  compressed response. Larger exports use jobs.
- Detail endpoints target ≤10 SQL statements; list endpoints target ≤6 plus bounded policy queries.
  CI query-count tests protect high-volume paths from N+1 regressions.
- Normal JSON request body cap is 1 MiB; sync batches initially cap at 100 operations or 2 MiB.
  Batch continuation is explicit.
- Direct upload sizes are per category and entitlement; initial caps: image 15 MiB, PDF 25 MiB,
  import 50 MiB. Multipart/object upload avoids API buffering and still enforces declared/actual
  limits.
- Database statement timeout: interactive reads 2 s, writes 5 s; bounded job queries may use a
  reviewed higher timeout. Lock waits are shorter than request timeout and produce classified
  retries/conflicts.
- No unbounded `SELECT`, cross-tenant scan, wildcard leading search on large tables without a
  supporting strategy, or synchronous aggregate over raw fleet data.

## Storage sizing baseline

Reference tenant/year rough order before indexes/compression/retention:

| Data                              |             Annual rows |                   Approximate raw size assumption |
| --------------------------------- | ----------------------: | ------------------------------------------------: |
| Invoices + lines                  |              72k + 288k |                                            0.3 GB |
| Payments + allocations + receipts |         60k + 84k + 60k |                                            0.2 GB |
| Audit/events/idempotency          |               2 million |                                            1.5 GB |
| Session observations/history      | 10 million if unbounded |         **Must aggregate/tier**; target hot ≤5 GB |
| Network jobs/attempts             |             730k + 1.1m |                                            1.5 GB |
| Core subscriber/config/operations |              <1 million |                                            0.8 GB |
| Files                             |                       — | 240 GB/year at 20 GB/month before lifecycle tiers |

Indexes and WAL/backups add substantial overhead; provision database usable storage at least 3×
estimated live logical data plus growth/maintenance headroom, and object storage according to
entitlement/retention. Session/bandwidth observations require aggregation and retention tiers; raw
high-frequency telemetry must not grow indefinitely.

## Queue and worker controls

| Work class        | Partition/concurrency                                                                    | Backpressure rule                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Financial posting | Tenant-partitioned; serialize only conflicting aggregate/sequence scope                  | Stop intake safely on DB saturation; retain durable queued command status.                         |
| Billing runs      | Fleet semaphore + per-tenant run cap                                                     | Jitter schedules; pause new chunks when DB/queue lag breaches threshold.                           |
| Mobile sync       | Per device ordering where dependent; cross-device concurrent                             | Batch/page limits; `429` with jittered retry; never drop accepted local keys.                      |
| Network jobs      | Per-router default concurrency 1 for mutations, configurable safe reads; global pool cap | Circuit opens on router failures; waiting jobs remain visible; priority cannot starve safety jobs. |
| Files/scanning    | Separate CPU/IO pool                                                                     | Quarantine remains inaccessible; cap decompression/work.                                           |
| PDF/export/import | Separate memory-limited pools                                                            | Stream/chunk; tenant quotas; expire artifacts.                                                     |
| Outbox relay      | Partition by owning database/tenant with leases                                          | Watermark alert; safe replay by event ID.                                                          |

Queue autoscaling considers oldest-message age, throughput and downstream saturation—not depth
alone. Per-tenant fairness prevents one billing run/router from starving others.

## Caching and projections

Cache only derived or repeatable data. Authorization is evaluated from canonical/session state and
cache entries include policy/version scope. Financial balances displayed from projections expose
freshness and reconcile to ledger queries. Cache invalidation is event/version based with bounded
TTL fallback. A cache outage degrades performance, not correctness or authorization; posting
continues if idempotency/locks are database-backed.

## Capacity test plan

| Test ID           | Scenario                                                                                              | Pass criteria                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| T-LOAD-REF-001    | 30-min mixed reference fleet: 800 web users, 500 syncing collectors, billing/network background load. | Read p95/p99 and error objectives met; no isolation/invariant failures; saturation documented. |
| T-LOAD-TENANT-001 | One large tenant with 25k subscribers, due lists, dashboard, payments and job views.                  | Bounded query counts/memory; p95 target or approved dedicated-profile target.                  |
| T-SPIKE-PAY-001   | 500 payment attempts/min with 10% duplicate keys and concurrent allocations.                          | Exactly one result per key; no negative/over allocation; p95 posting objective.                |
| T-BILL-001        | Reference 5k and large 25k invoice run with injected 2% failures/retry.                               | Time objective for reference; retries only failed; duplicate invoice = 0.                      |
| T-MOB-SOAK-001    | 500 devices, offline backlog/reorder/reconnect for 8 hours.                                           | No lost/duplicate operation; bounded API/DB/queue; conflicts classified.                       |
| T-NET-BACKLOG-001 | 1,500 routers with latency/offline/uncertain mix and worker restarts.                                 | Per-router ordering/circuit/reconciliation hold; queue survives; no blind repeat.              |
| T-EXPORT-001      | Concurrent large exports plus normal interactive traffic.                                             | Tenant quota/fairness; interactive SLO remains; formula-safe scoped results.                   |
| T-SOAK-001        | 24-hour mixed load.                                                                                   | No monotonic memory/connection/queue growth; error budget and invariant checks pass.           |
| T-FAILOVER-001    | Worker/API/Redis restart and database failover under queued work.                                     | Accepted work survives; no duplicate finance/network effect; recovery within objectives.       |

Datasets use synthetic bilingual Lebanese-like names/locations and no real PII. Test reports record
commit/artifact, environment topology/resources, schema/data size, script/version, workload,
percentiles, throughput, error classes, saturation, queue lag, query plans, invariant checks and raw
report artifact.

## Scaling and isolation triggers

- At 60% sustained CPU, 70% memory, 70% DB connection budget, or queue oldest-age at 50% of its SLO
  for 15 minutes, investigate and scale only after checking downstream saturation.
- At 70% storage or forecasted 90-day exhaustion, provision/tier before maintenance headroom is
  lost.
- Move a tenant to dedicated workload pools/deployment when it repeatedly consumes >20% of shared
  API/worker capacity, requires a distinct region/SLO, or threatens fairness despite quotas.
- Add read replicas only for proven read projections that tolerate lag. Never send authorization,
  posting, idempotency or read-after-write financial checks to a lagging replica.
- Partition high-volume audit/event/session/job tables by time only after query/load evidence; keep
  uniqueness and retention semantics explicit.
- Introduce additional services only when independent scaling/failure/security ownership is measured
  and an ADR describes transaction/operation cost.

## Alerts and runbook ownership seed

| Signal                      | Initial alert                                                            | Owner                      |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| API 5xx / p95               | >2% 5xx for 5 min or p95 >800 ms for 15 min                              | Core API on-call           |
| Payment posting failures    | >1% valid commands for 5 min or any idempotency invariant alarm          | Finance + SRE, critical    |
| Outbox/inbox lag            | Oldest >2 min routine or >10 min batch                                   | Owning worker team         |
| Mobile sync backlog         | p95 accepted age >5 min for 15 min                                       | Mobile/API                 |
| Network jobs                | Oldest safety job >2 min; router circuit count anomalous                 | Network operations         |
| DB                          | connection >80%, storage >70%, lock wait p95 >250 ms, backup/WAL failure | DBA/SRE                    |
| Backups                     | missed schedule/checksum or restore test overdue                         | SRE, high                  |
| Tenant-isolation/fraud rule | Any high-confidence isolation event or payment invariant violation       | Security/Finance, critical |

Thresholds must be tuned against staging/production baselines and link actionable runbooks. Alerts
use opaque tenant/deployment IDs and avoid PII.

## Open capacity questions

Owner acceptance is still required for commercial limits, expected first-year tenant count, hosting
region/instance budget, attachment retention, raw network observation retention,
RPO/RTO/availability, mobile offline maximum, and exact RouterOS polling expectations. These map to
DEC-003, DEC-004, DEC-007, DEC-008 and DEC-009 in the
[decision register](../requirements/assumptions-and-risks.md).
