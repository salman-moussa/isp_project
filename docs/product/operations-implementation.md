# Orvex ISP Operations Phase D implementation

## Implemented boundary

Migration `202608112200_tenant_operations_core.sql` and the Operations domain, repository, API
plugin, and tenant workspace implement `REQ-OPS-001..010`, `REQ-SEC-003`, and the Operations side of
`REQ-FIN-001`. This is an internal ISP staff surface. It creates no subscriber identity, password,
session, login, portal, or public subscriber API.

The concrete mutation contracts cover subscriber/location capture; effective plan and billing-policy
versions; service plus installation creation; recurring invoice preparation; posted office-payment
evidence and linear corrections; collector assignment, posted collection evidence, and
reconciliation; installation and support transitions; exports; non-secret configuration; and
explicit network actions. Invoice preparation remains a draft boundary. Actual invoices, payments,
allocations, and reversals remain in the immutable finance journal.

## Authorization and scope

Operations RLS does not use `app.tenant_id` or caller-written scope GUCs. The trusted API context
authority signs an exact JSON attestation with a secret-store HMAC key. The database verifies the
signature and five-minute maximum expiry, then installs tenant, actor, session/support grant,
permission, action, request, retry identity, and branch/area/route/record arrays in an
owner-protected transaction row. Operations policies read only that row. Omitted arrays mean
unrestricted for that dimension; empty arrays deny every target.

The composition adapter must re-resolve the membership/support authority before signing, including
canonical `tenant_memberships.scope.recordIds` even though older session tokens may not contain that
dimension. It must never sign request-body scope as authority. The route rejects an explicitly
selected branch, area, or route outside the verified claims; PostgreSQL rechecks denormalized scope
links and parent-record scope.

Provisioning is exact and secret-separated in `packages/database/src/operations/provisioning.sql`.
Run it as cluster administrator after migration 2200 with `operations_context_key_id` and a
secret-store `operations_context_key_hex`. Inject the same 32-byte-or-longer key into the API
signer. Do not expose it to `orvex_runtime` or log the attestation signature.

## Financial and workflow integrity

- Billing runs cannot overlap for a tenant, are limited to 31 days, and cannot prepare the same
  service/period twice. Selection requires an active service, an anchor inside the half-open period,
  activation/termination eligibility, the plan interval, an effective immutable plan version, and
  the effective branch-specific or tenant-wide VAT/rounding policy. Callers do not submit VAT.
- Office-payment requests must exactly match a posted finance payment. Corrections are append-only,
  lock the request, extend the single current tail, preserve payment/allocation currency and amount,
  and require reversal evidence to reverse an earlier allocation in that chain.
- Collector assignment amount/currency are derived from the locked outstanding posted invoice.
  Collection evidence derives amount/currency from an active posted payment. Reconciliation locks
  the selected assignment/evidence set and derives both totals. A non-zero difference requires an
  eight-character reason and an independent approver; reconciliation history is linear.
- Installation events enforce version, allowed transition, scheduling/installer prerequisites,
  blocker reason, completion evidence, and pending-service state in PostgreSQL. Support transitions
  likewise enforce version, allowed transitions, and resolution evidence.

## Audit, network, and secrets

Every committed Operations row insert/update/delete adds an `operations_audit_outbox` event in the
same transaction with resource, result, actor/session/support context, permission, request and
idempotency identities, IP/user agent, reason, and complete before/after values. Failed or denied
requests are recorded by the existing security/denial plane because a rolled-back tenant transaction
cannot atomically retain a failed result. The isolated relay receives only owner-mediated list/read/
acknowledge functions; runtime has no outbox DML.

Platform commercial state is copied to an immutable event history on tenant insert and status
change. The network trigger reads the latest immutable event and allows only `trial` or `active`;
missing or other state fails closed. A commercial-state change never enqueues subscriber suspension.
Payloads are strict per action: activate/restore are empty, profile change contains only
`profileReference`, and suspend/terminate contain only `reasonCode`. Recursive secret-like keys are
rejected in both network payload and Operations configuration.

## Integration, readiness, and release gate

The composition owner supplies an `OperationsWriter` that builds canonical attestations with
`signOperationsAttestation`, gives them a maximum 60-second application expiry, and invokes the
repository methods. Map Operations idempotency and business conflicts to 409, signed-context/scope
failure to 403, and schema failure to 400. Allowed HTTP audit must not be appended after commit; the
database outbox is the authoritative atomic evidence.

Readiness must call `operations_readiness()` and fail when `context_key_ready` or
`subscription_state_ready` is false. Relay readiness additionally applies deployment thresholds to
`pending_audit_count` and `oldest_pending_audit_at`. Do not claim readiness from static
configuration.

Before release, validate both a fresh PostgreSQL 18 database and the immediately preceding migrated
schema, run `packages/database/src/operations/test-live-operations.mjs` using separate administrator
and `orvex_runtime` URLs, and capture evidence for invalid signatures, raw-GUC spoof denial,
cross-scope denial, overlapping billing concurrency, complete atomic audit, new-tenant subscription
capture, runtime grants, and migration adoption. No live OMT, Whish, MikroTik, or payment credential
is required. Migration 2200 is forward-only; routine rollback must not drop populated Operations
data.

## UI truthfulness

`OperationsWorkspace` defaults to an empty—not successful—state. Offline mode disables mutation and
says inputs remain only on the current screen; it does not claim durable draft storage. Task changes
focus the new heading. English and Arabic copy, LTR/RTL, loading, empty, error, denied, offline,
retry, and explicit committed-success states are present. The component is still a presentation
boundary; composition must pass actual API state and callbacks.
