# Performance and reliability test plan

Status: provisional targets and workload; product owner and SRE must approve capacity assumptions
before results are used as acceptance evidence.

## Initial service objectives under reference load

- Normal authenticated read APIs: p95 below 400 ms, p99 below 1 s, excluding documented provider
  latency.
- Financial writes: p95 below 750 ms while maintaining transaction/idempotency guarantees;
  correctness takes priority over latency.
- Error rate below 1% for eligible requests; expected validation/authorization responses are
  reported separately.
- Queue: 99% of routine jobs start within 30 s; priority payment/sync jobs within 10 s. Bulk and
  external-network jobs have separate classes.
- Interactive UI acknowledges input within 100 ms and shows progress for longer operations.
- Mobile success is shown only after durable local persistence; sync survives interruption and
  replay.

## Provisional reference profile

Model 50 active shared-hosted tenants, 5,000 subscribers per tenant, 50 concurrent staff, 100
concurrently syncing collectors, 100 routers, 2 million invoices and 2 million payments in retained
test data, 20 routine jobs/s with a 10x five-minute burst, and object metadata representative of 1
TB without allocating that payload. Dedicated/self-hosted profiles scale from measured single-tenant
results. Revise after commercial forecasts and telemetry are available.

## Scenarios

1. Dashboard/list reads with pagination, filters and aggregate refresh; detect N+1 and unbounded
   cross-tenant queries.
2. Concurrent payment posting/allocation with retry-after-timeout and repeated idempotency keys.
3. Monthly billing burst, PDF/export generation, progress polling and retry of failures.
4. Collector morning bootstrap and evening offline-sync burst with conflicts and revoked devices.
5. Queue backlog, worker restart, dead-letter, Redis/database interruption and recovery.
6. MikroTik fleet polling and commands with slow/offline routers, timeouts and uncertain outcomes.
7. Webhook duplicate burst, public verifier abuse limit and authentication throttling.
8. Eight-hour soak at normal load, one-hour peak, and controlled saturation to establish
   capacity/alerts.

## Method

Use generated synthetic data and an isolated production-like topology. Pin artifact, schema, load
script and dataset generator versions. Warmup and measurement windows are distinct. Record
client/server resource saturation, database queries/locks/connections, cache hit/eviction, queue
depth/age, object errors, GC/event-loop, latency histograms and correctness invariants. Do not
average away tenant or operation outliers.

Abort criteria include tenant leakage, duplicate financial/network records, data corruption,
uncontrolled error amplification, or sustained resource exhaustion threatening the test environment.
A latency pass cannot override a correctness failure.

## Result template

Record UTC time, environment/IaC revision, artifact digest, dataset seed/counts, load-generator
version, exact command, scenario/arrival model, warmup/duration, p50/p95/p99/max, throughput/error
classification, resource peaks, queue age, database top queries, correctness checks, threshold
result, bottleneck, remediation and rerun link. No results exist until a dated record is committed
or stored in the approved evidence system.
