# Orvex ISP Collect backend reference vertical

Status: implementation-ready isolated vertical; shared composition hooks are intentionally left to
the repository owner. Requirements: REQ-COLLECT-001..009, REQ-FIN-001/002, REQ-SEC-003/006.

## Security and authorization contract

Device authorization is a tenant-session operation. The session must belong to the same current
tenant collector, carry `tenant.collection.view` and `tenant.payment.post`, have a current source
session, and have MFA verified in the preceding ten minutes. Platform support grants cannot create
devices or act as collectors. The authorization response is the only time the API returns the opaque
access and refresh tokens.

Only SHA-256 digests of 256-bit random access and refresh tokens are stored. Access tokens live for
ten minutes by default and never more than fifteen minutes. Refresh tokens rotate on every use, live
for fourteen days by default and never more than thirty days, and are rejected after the device,
source web session, user, or tenant collector membership is revoked. A mobile build must store the
refresh token in the platform secure key store and must never place either token in the SQLite
payload database, logs, crash reports, analytics, URLs, or backups. All endpoints require TLS. The
stored public-key thumbprint enables a future proof-of-possession upgrade; the current contract is a
short-lived opaque bearer token and does not claim DPoP.

Every bootstrap, delta, and sync transaction enters the existing HMAC-signed Operations context. The
device identity, tenant, collector, source session, permissions, and device status are checked again
in PostgreSQL on every request. Undefined scope remains unrestricted per the existing Operations
convention; the device is additionally restricted to its own collector identity and assignments. No
request header supplies tenant or collector authority.

## Sync behavior

`POST /v1/collect/sync` accepts 1-100 ordered, contiguous operations. Each device has a monotonic
sequence. The operation ledger key is `(tenant, device, operationId)`, with an additional unique
sequence. Payloads are canonicalized with sorted object keys and hashed with SHA-256. An exact retry
returns the stored result. Reusing an operation ID or sequence with changed content returns a
conflict and rolls back the complete batch. Failed operations do not consume sequence numbers.

Supported operations are:

- `payment.create`: locks the current assignment and invoice guard; verifies the assignment still
  belongs to the device collector, has not already been collected, is backed by an active posted
  invoice, and that amount and currency exactly match the current outstanding balance. It then
  atomically inserts the immutable finance payment, allocation, collection evidence, finance audit
  outbox entries, Operations audit outbox entry, and sync result. Receipt number and posting time
  are canonical server values. Client time is evidence only.
- `reconciliation.submit`: derives the collected total on the server for one route, business date,
  collector, and currency. USD and LBP are separate rows and are never summed. A zero discrepancy is
  accepted. A non-zero discrepancy remains `pending_approval` until a different active user with
  `tenant.collection.reconcile` approves it with a reason and idempotency key.
- `receipt.print.audit`: verifies that the immutable payment evidence belongs to the current
  collector and appends an immutable original/duplicate print event with printer reference and
  server time.

Conflict responses expose only safe facts: operation identity conflict, sequence gap, stale
assignment/balance, invalid ownership, or pending-approval state. They do not disclose another
collector, subscriber, invoice, tenant, token digest, or balance.

Bootstrap returns only current payable assignments for the authenticated collector. Delta uses a
server-owned monotonic assignment-change cursor and returns current assignments plus identifiers
that the device must remove. A cursor is not an authorization capability; every delta re-runs the
same device and collector checks.

## HTTP surface

- `POST /v1/tenants/:tenantId/collect/devices/authorize` — tenant JWT plus fresh MFA.
- `POST /v1/collect/token/refresh` — rotating opaque refresh token; heavily rate limited.
- `GET /v1/collect/bootstrap` — Collect access token.
- `GET /v1/collect/delta?cursor=…&limit=…` — Collect access token; maximum 500 changes.
- `POST /v1/collect/sync` — Collect access token; maximum 100 operations.
- `POST /v1/tenants/:tenantId/collect/reconciliations/:id/approve` — independent tenant manager,
  fresh MFA, `tenant.collection.reconcile`, and `Idempotency-Key`.

All responses use `Cache-Control: private, no-store`. Authorization and token endpoints must keep
authorization headers and token-bearing bodies out of logs. Production rate limiting must use a
shared store rather than per-process memory.

## Deployment and migration

Apply `202608112300_tenant_collect_sync.sql` to every tenant database after
`202608112200_tenant_operations_core.sql`. It creates device/token-digest state, ordered operation
evidence, reconciliation approval evidence, receipt print evidence, assignment deltas, RLS, secure
token lookup/rotation functions, and an immutable Collect audit outbox. It never alters prior
migrations. Rollback is forward-only: disable route traffic and deploy a compensating migration;
never delete finance, operation, reconciliation, print, or audit evidence.

Relay `collect_audit_outbox` through `read_collect_audit_outbox(tenant, batch)` and
`mark_collect_audit_delivered(event, time)` using `orvex_finance_audit_relay`. Alert on oldest
undelivered age, pending count, sync conflict rate, refresh reuse failures, revoked-device access,
pending discrepancy age, and reconciliation currency-specific totals.

## Exact composition hooks

The isolated implementation deliberately did not edit shared barrels, manifests, lockfiles, or
composition roots. The integration owner must:

1. Add `"202608112300_tenant_collect_sync.sql": "tenant"` to
   `packages/database/migration-scopes.json`.
2. Export `./collect/index.js` from `packages/database/src/index.ts`.
3. Construct a `CollectBackendRepository` adapter in API composition that delegates to
   `authorizeCollectDevice`, `authenticateCollectAccessToken`, `rotateCollectTokens`,
   `readCollectBootstrap`, `readCollectDelta`, `syncCollectOperations`, and
   `approveCollectDiscrepancy` with the tenant `Database`.
4. Construct `CollectApiService` with the same secret-store-backed Operations HMAC key used by the
   Operations service; never place key bytes in configuration files.
5. Add the service to `AppDependencies`, call `registerCollectRoutes`, and map
   `CollectAuthorizationError`, `CollectConflictError`, `CollectValidationError`, and
   `CollectTokenInvalidError` to 403/409/400/401 error envelopes.
6. Add the migration to the fresh tenant PostgreSQL integration gate and relay Collect audit events
   to the control audit stream with full immutable-envelope verification before delivery marking.

The route and service files compile independently once those hooks are wired. Until composition is
completed, no public Collect backend route is mounted; this is fail-closed by design.
