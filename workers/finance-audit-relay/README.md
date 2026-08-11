# Finance Audit Relay

The production relay copies immutable finance audit evidence from tenant-plane outboxes to the
control-plane audit store by calling the idempotent `@isp/database` relay contract. It drains one
bounded batch per configured tenant per cycle, applies independent capped retry backoff, and waits
for an in-flight batch before shutting down.

## Runtime configuration

- `FINANCE_AUDIT_CONTROL_DATABASE_URL`: control audit runtime DSN (required).
- `FINANCE_AUDIT_TENANTS_JSON`: non-empty JSON array of
  `{ "tenantId": "<uuid>", "databaseUrl": "postgresql://..." }` (required). Inject it from the
  deployment secret system; never put credentials in a checked-in manifest. Entries seed the
  tenant-database routing map. On every cycle, the relay's restricted discovery function adds and
  drains any tenant with pending evidence in each configured database, so new or omitted tenant IDs
  cannot leave hidden work behind.
- `FINANCE_AUDIT_BATCH_SIZE`: `1..500`, default `100`.
- `FINANCE_AUDIT_POLL_INTERVAL_MS`: default `1000`.
- `FINANCE_AUDIT_BACKOFF_BASE_MS`: default `250`.
- `FINANCE_AUDIT_BACKOFF_MAXIMUM_MS`: default `30000`.
- `FINANCE_AUDIT_BACKOFF_JITTER_RATIO`: `0..1`, default `0.2`.
- `FINANCE_AUDIT_READINESS_MAX_BACKLOG_COUNT`: default `500`.
- `FINANCE_AUDIT_READINESS_MAX_BACKLOG_AGE_MS`: default `120000` (two minutes).
- `FINANCE_AUDIT_READINESS_MAX_STALE_MS`: default `60000`.
- `FINANCE_AUDIT_HEALTH_HOST` / `FINANCE_AUDIT_HEALTH_PORT`: default `0.0.0.0:9464`.

The process never logs DSNs, database errors, event payloads, actor IDs, or idempotency keys. Its
structured logs contain only operational event names, tenant IDs, retry counters, and aggregate
batch/backlog counts.

## Machine health signals

- `GET /live`: process liveness.
- `GET /ready`: `200` only after the control dependency and every tenant have proved the required
  schema/privileges, succeeded recently, have no current failure, and remain within the configured
  backlog count and oldest-age thresholds; otherwise `503`.
- `GET /health`: operational snapshot containing last success, delivered total, retry state, exact
  pending backlog count, and oldest event time per tenant.

Build the production image from the repository root:

```sh
docker build -f workers/finance-audit-relay/Dockerfile --target runtime .
```
