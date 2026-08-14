# Scaling, backpressure, pooling, and read models

Status: rollout design. The current API is stateless at process level but uses direct PostgreSQL
pools, while finance/operations audit and subscription-state delivery share one relay process.
Controls below are acceptance gates for later implementation rather than claims about deployed
behavior.

## Workload isolation contract

| Pool                    | Ordering/fairness                                | Initial concurrency control                 | Failure containment                                             |
| ----------------------- | ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| API interactive         | Per-route/IP/account/tenant limits               | instance concurrency + DB pool budget       | `429`/`503` with retry hints; never unbounded wait              |
| Finance posting         | Serialize only conflicting invoice/payment scope | low fixed worker cap, tenant fair scheduler | invariant failure pages; retry only classified transient errors |
| Billing                 | one active run/tenant, checkpointed chunks       | fleet semaphore + per-tenant cap            | pause chunks on DB saturation; idempotent resume                |
| Mobile sync             | device order where dependent, tenant quota       | bounded batches and device/tenant tokens    | accepted keys persist; reconnect uses jitter                    |
| Network mutation        | concurrency one/router by default                | router + tenant + global semaphores         | circuit break; unknown outcome requires reconciliation          |
| Documents/import/export | tenant quota, separate CPU/RSS pool              | stream and bounded chunking                 | cannot consume API/payment worker capacity                      |
| Integration/webhook     | provider and tenant partitions                   | provider circuit + global cap               | signed durable inbox; DLQ and audited replay                    |
| Audit/outbox relay      | owning DB/tenant leases                          | bounded batch and database budget           | poison item isolated; backlog remains queryable                 |
| Backup/deployment       | deployment window and I/O budget                 | one task/DB unless measured safe            | readiness and latency abort thresholds                          |

Every accepted asynchronous command has a durable state before acknowledgement, a stable idempotency
key, attempt classification, a deadline, bounded exponential backoff with jitter, a DLQ or
human-resolution state, and opaque correlation attributes. Broker delivery alone is not audit.

## Backpressure ladder

1. Reject oversized batches/bodies before allocation.
2. Apply per-account/device and per-tenant token budgets, then a global concurrency budget.
3. Stop claiming new jobs when downstream DB/router/provider saturation crosses its guard.
4. Let accepted durable work wait visibly; do not hold HTTP sockets as a queue.
5. Return `429` for a caller-specific quota with bounded `Retry-After`; return `503` when shared
   capacity is unavailable. Do not retry non-idempotent effects automatically.
6. Shed reporting/export first, then optional sync downloads. Preserve authentication, payment
   correctness, support revocation, and network safety operations.
7. Page on oldest age and correctness, not depth alone. Scaling consumers is forbidden if the
   database/provider is already saturated.

Fair scheduling uses tenant deficit/weighted round-robin with entitlement ceilings and an emergency
safety lane. Priority must age upward so normal work cannot starve forever. One tenant repeatedly
using more than 20% of shared capacity despite quotas triggers a dedicated-pool review.

## PostgreSQL and pooler rollout

The API currently opens separate control-auth, control-runtime and tenant pools per process. Count
all three plus each relay/worker pool before increasing replicas.

```text
usable_server_connections = max_connections - superuser_reserve - migration_reserve - probe_reserve
application_budget <= floor(usable_server_connections * 0.70)
per_process_pool = floor(application_budget / simultaneous_process_count)
```

- Profile A begins with small direct pools only if the connection worksheet proves headroom.
- Profile B puts PgBouncer (transaction pooling) between stateless services and PostgreSQL. Session
  state is forbidden. Tenant/security context remains `SET LOCAL` inside an explicit transaction;
  prepared-statement behavior must be tested with the chosen client/pooler mode.
- Each transaction gets `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`,
  application name, and verified local context. A test must prove context does not survive pool
  reuse.
- Pool wait duration, in-use/idle counts, DB utilization and canceled statements are mandatory
  metrics. API admission capacity is bounded before the pool queue becomes unbounded.
- Read replicas may serve only named projections tolerant of lag. Authorization, membership,
  support-grant checks, payment/idempotency, network desired state and read-after-write finance
  remain on primary.

## Read model and cache plan

Dashboard/report reads use tenant-scoped projection tables updated by owning transactions/outbox.
Each response exposes `asOf`/watermark and a stale state. Projection rebuilds are idempotent,
checkpointed and compare totals with canonical records. Cache keys are
`environment:plane:opaqueTenantKey:projection:version:parametersHash`; authorization is evaluated
before use and never inferred from a cache hit. Cache outage degrades performance, not correctness.

Cross-tenant Control Center metrics consume explicitly approved aggregate events. They must not scan
tenant subscriber/financial PII or reuse a support grant. Redis is suitable for ephemeral rate
limits, leases, cache and broker coordination after HA/persistence behavior is chosen; PostgreSQL
remains the canonical business record.

## Scale decision record

For each change, capture before/after load, hardware, bottleneck, query plans, DB connections, queue
oldest age, error classes, business invariant checks, cost and rollback. Do not add Kubernetes,
partitioning, replicas, caches, or services only to satisfy a topology diagram.
