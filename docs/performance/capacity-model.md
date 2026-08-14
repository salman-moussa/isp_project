# Capacity model and evidence ledger

Status: planning model; no staging measurements captured. Requirements: PRD-NFR-001..004,
PRD-OPS-005. This model complements the architectural baseline in
`docs/architecture/capacity-and-performance.md` and must be reconciled there by the integration
owner.

## Boundaries and target

The long-term design target is approximately 250 ISP tenants and 2,000,000 subscribers, with large
tenants in the tens of thousands and thousands of concurrent staff/collector sessions. It is not a
tested capacity statement. The current implementation is a Fastify API with separate control and
tenant PostgreSQL connections plus a dedicated finance/operations audit relay. A general durable
queue, Redis, object-storage adapters, PgBouncer, and OpenTelemetry runtime instrumentation are not
yet proven in this worktree; model rows depending on them remain release gates.

## Inputs and formulas

All quantities below are explicit planning inputs. Replace them with sampled `pg_column_size`,
index/WAL observations, object inventory, and traffic telemetry from a synthetic staging dataset.

| Input                                    |     Planning value | Sensitivity / source required                                  |
| ---------------------------------------- | -----------------: | -------------------------------------------------------------- |
| Tenants                                  |                250 | Commercial forecast                                            |
| Subscribers                              |          2,000,000 | Commercial target, not launch load                             |
| Average subscribers per tenant           |              8,000 | Derived; distribution is expected to be skewed                 |
| Invoice cycles                           |            12/year | Tenant policy can differ                                       |
| Invoice header + lines logical bytes     |      4 KiB/invoice | Replace with sampled relation + TOAST + index bytes            |
| Payment/allocation/receipt logical bytes |      3 KiB/payment | Replace with sampled relation + index bytes                    |
| Audit/job/event logical bytes            |      1.2 KiB/event | Payload allowlist and index count dominate                     |
| Network observation retained hot         |  0.5 KiB/aggregate | Raw high-frequency observations must be rolled up/tiered       |
| File bytes                               | Entitlement-driven | Must come from object inventory, never a DB-row multiplier     |
| DB physical multiplier                   |         3x logical | Includes indexes, WAL/maintenance and safety headroom; measure |
| Backup transfer bytes                    | full + change rate | Compression/encryption ratio must be measured                  |

Formulas:

```text
annual_invoice_logical_bytes = subscribers * invoice_cycles * invoice_bytes
annual_payment_logical_bytes = annual_payments * payment_bytes
annual_event_logical_bytes = annual_events * event_bytes
provisioned_db_bytes >= 3 * (live_logical_bytes + forecast_growth)
backup_window_seconds = encrypted_backup_bytes / sustained_measured_upload_bytes_per_second
db_connections = sum(api_pool_i + worker_pool_i + relay_pool_i + admin_reserve)
pooler_client_limit >= peak_concurrent_transactions / measured_transaction_duty_cycle
```

Example arithmetic may be used for sizing discussions but is not benchmark evidence. At the full
target, invoice logical volume alone under the 4 KiB assumption is about 96 GB/year before physical
overhead. The number should be recalculated from actual schema samples before purchase decisions.

## Traffic shape worksheet

| Workload               | Shape to parameterize                                | Required measured fields                                           |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Staff reads/writes     | Business-hour ramp, lunchtime dip, end-of-day burst  | active sessions, req/s, route mix, p50/p95/p99, DB time            |
| Collector sync         | Morning download and evening reconnect/upload bursts | devices, operations/batch, duplicate %, conflict %, offline age    |
| Billing                | Renewal-day tenant waves with jitter                 | subscribers/chunk, chunks/min, duration, retries, DB/WAL/lock load |
| Payment/reconciliation | Office/collector peaks and provider webhook bursts   | posts/min, duplicate keys, allocations, invariant failures         |
| Network jobs           | Renewal/suspension batches plus slow/offline routers | jobs/min, router latency, unknown outcomes, per-router queue age   |
| Documents/exports      | Bursty CPU/memory/object I/O                         | document size, concurrency, RSS, object latency, API SLO impact    |
| Audit/outbox relay     | Continuous with recovery burst after outage          | events/s, oldest age, batch time, retry and poison-event count     |
| Backup                 | Scheduled read/I/O/network load                      | DB/object bytes, duration, WAL growth, production latency impact   |

## Reference staging increments

Do not jump directly to the long-term target. Each increment must hold a synthetic but realistic
data distribution and run correctness queries before progression.

| Gate                | Tenants | Subscribers |     Concurrent clients | Purpose                                                       |
| ------------------- | ------: | ----------: | ---------------------: | ------------------------------------------------------------- |
| S0 harness          |       1 |       5,000 |                     25 | Validate scripts, telemetry, synthetic data and invariants    |
| S1 reference        |      10 |      50,000 |                    200 | Establish bottleneck and query/connection baseline            |
| S2 shared           |      50 |     400,000 |                    800 | Validate tenant fairness, relay recovery and worker isolation |
| S3 scale projection |     100 |   1,000,000 |                  2,000 | Only after S2 passes and staging resources are approved       |
| Long-term           |     250 |   2,000,000 | measured business peak | Architectural target, not an automatic test gate              |

## Initial limits requiring measurement

- HTTP: p95 normal authenticated reads under 500 ms and ordinary non-provider write acknowledgements
  under 750 ms at the declared reference load; p99 and error classes must also be reported.
- Database: reserve at least 20% server connections for migrations, probes and incident response.
  Application pools target no more than 70% of the usable budget; exact pool sizes require measured
  transaction duty cycle.
- Interactive statements start at 2 seconds and writes at 5 seconds. Job statements need separately
  reviewed bounded timeouts. Lock wait timeout is shorter than request timeout.
- Outbox/payment routine oldest age starts at 120 seconds; network safety work at 120 seconds;
  batch/report jobs have separately accepted objectives. These are candidates pending staging.
- Storage scaling starts before 70% consumed or a 90-day forecast breaches maintenance headroom.
- Partitioning is triggered by measured query/maintenance pain and retention boundaries, not row
  count alone.

## Evidence ledger

| Evidence                             | State    | Promotion requirement                                       |
| ------------------------------------ | -------- | ----------------------------------------------------------- |
| Bounded local HTTP harness           | Prepared | Run against built API and retain JSON                       |
| Authenticated mixed route model      | Missing  | Synthetic identities, tenant-scoped route mix, no PII       |
| Payment duplicate/concurrency driver | Missing  | Invariant queries and canonical result verification         |
| Collector offline/reorder driver     | Missing  | Durable client/outbox implementation and loss checks        |
| Billing/network worker load          | Missing  | Durable queue/worker implementations or simulators          |
| Query plans at S0/S1                 | Missing  | `EXPLAIN (ANALYZE, BUFFERS, WAL)` with sanitized parameters |
| 8-hour and 24-hour soak              | Missing  | Production-like staging and telemetry retention             |
| Backup/restore RPO/RTO               | Missing  | Isolated encrypted restore plus application smoke           |

No row moves to “proven” based on code review or a diagram.
