# Orvex ISP Network Worker

Status: Phase F isolated implementation. Requirement IDs: REQ-NET-001 and REQ-NET-002.

Build with `npm run build --workspace=@isp/network-worker` and run the local simulator
health/polling process with
`NETWORK_WORKER_MODE=simulator npm run start --workspace=@isp/network-worker`. Build the container
from the repository root with `docker build -f workers/network-worker/Dockerfile .`. The runtime
image uses the unprivileged `node` user and writes no local state, so it is compatible with a
read-only root filesystem. `configured` mode intentionally refuses to start from the standalone
entrypoint: the application composition root must inject the production durable store and official
RouterOS adapter. This prevents an accidental production fallback to in-memory jobs or a simulator.

The Network Worker is the only component allowed to communicate with configured RouterOS endpoints.
Core API integration must implement the `DurableNetworkStore` boundary with a transactional durable
queue and must pass only `NetworkJobRequest` messages. Router credentials are secret-manager
references. They must be resolved inside the worker immediately before an adapter call and must
never be persisted in a job, log, trace, browser, mobile database, export, error, or screenshot.

## Safety model

- Every request has a request ID, tenant-scoped idempotency key, explicit actor, permission, reason,
  desired state, and origin.
- The egress policy permits only registered origins. Non-simulator RouterOS REST endpoints require
  HTTPS or a secure site connector.
- Per-router concurrency, bounded exponential retry, circuit breakers, timeouts, dead-letter state,
  and manual retry are explicit worker concerns.
- A timeout or transport loss is `uncertain`, never an ordinary failure. Before retrying an
  uncertain destructive command, the worker reads observed state. A matching state completes as
  `reconciled`.
- A successful acknowledgement with inconsistent observed state is also uncertain.
- Bulk selection produces an exact, immutable preview of inclusions and exclusions. Confirmation
  records actor, permission, reason, approval, digest, and timestamp; each member remains an
  independently idempotent network job.
- `platform.subscription.state_changed` is an explicitly rejected ingress type. Platform commercial
  state can restrict Orvex ISP application access but cannot suspend or otherwise change a
  subscriber's network service.

## Simulator matrix

The checked-in fixture at `workers/network-worker/fixtures/routeros-simulator-matrix.json` covers
success, slow response, timeout/uncertainty, authentication failure, offline router, partial bulk
result, rate limit, inconsistent observed state, and reconnect. The adapter is an in-process
behavior simulator; it does not imitate an undocumented RouterOS endpoint.

## Integration hooks for the composition owner

1. Add `@isp/network-worker` to the root worker build and validation scripts.
2. Implement `DurableNetworkStore` on the tenant PostgreSQL network-job tables with atomic claim
   semantics (`FOR UPDATE SKIP LOCKED` or equivalent), unique `(tenant_id, idempotency_key)`,
   append- only attempts, and an observable dead-letter queue.
3. Resolve router registrations and secret references tenant-locally; the worker must never accept a
   caller-supplied endpoint not present in the registry.
4. Expose only tenant-authorized enqueue/status/cancel/manual-retry commands from Core API. Use the
   immutable bulk preview/approval model for bulk work.
5. Run worker queues separately from authentication, payments, billing, exports, and provider
   webhooks so router slowness cannot starve other workloads.
6. Add deployment egress rules and a least-privilege RouterOS account. Validate connection and
   health before activation.

## Operations

Alert on queue age, dead-letter count, uncertainty count, circuit-open duration, authentication
failures, per-router latency, and observed-state mismatches. Manual retry must create a new audited
request referencing the failed job; it must not edit prior attempts. During a broad router outage,
stop automatic retries, preserve the queue, restore connectivity, probe health, and drain one router
at a time. Credential compromise requires secret rotation, RouterOS account revocation, worker
restart, egress review, and audit review.

No live RouterOS call is included in this phase. The production adapter must follow current official
RouterOS API/REST documentation and remain replaceable behind `RouterAdapter`.
