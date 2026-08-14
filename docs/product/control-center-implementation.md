# Control Center client domain slice

Status: production-composed implementation slice awaiting fresh-PostgreSQL validation. It is not
deployed.

## Implemented behavior

REQ-CC-001 through REQ-CC-007 cover ISP clients and contacts, immutable bilingual package versions,
package assignment, commercial subscription lifecycle, platform invoices/payments/allocations,
deployment/support drill-down, and bilingual task states. Commercial restriction changes Orvex
software access only. No schema object or API response can enqueue subscriber network work.

Restrictive and terminal transitions are two authenticated operations. The requester creates a
pending request; a different actor later approves it from a current platform session with the
required permission and MFA verified in the preceding ten minutes. The request body cannot name an
approver or choose `occurredAt`. Approval re-locks the subscription and rejects a stale revision.

Every mutation is idempotent by `(operation, idempotency_key)` plus a canonical request hash. The
claim is written inside the business transaction, so concurrent identical calls converge on the
committed result and a different payload gets `IDEMPOTENCY_CONFLICT`. Client, contact, package,
subscription assignment, transition request, transition approval, invoice, and payment paths all use
this mechanism.

## Security and audit model

`202608112100_control_center_core.sql` is a control-database migration. Before it runs, deployment
must create the dedicated `NOLOGIN`, `NOBYPASSRLS` role `orvex_control_runtime`. The API login gets
SET-only membership:

```sql
GRANT orvex_control_runtime TO <control_api_login>
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
```

The Control Center adapter uses a separate `CONTROL_DATABASE_URL`, enters that role for the
transaction, and never reuses a tenant-plane DSN. Authentication/session/security audit adapters use
`AUTH_CONTROL_DATABASE_URL` with the existing generic runtime login; keeping these connection pools
separate prevents the SET-only Control Center login from acquiring unrelated privileges. The role
receives SELECT on the safe client projection and audit events, plus EXECUTE on named
`SECURITY DEFINER` command functions. It receives no base-table INSERT, UPDATE, DELETE, TRUNCATE,
sequence, or owner privilege.

Client records do not duplicate lifecycle state. The read projection derives it from the one
subscription row (or `lead` before assignment), and a trigger rejects direct subscription writes.
Package insertion serializes on package key, requires versions to rise by exactly one, and rejects
overlapping effective periods.

High-risk evidence is appended in the same control-database transaction as each accepted mutation.
The immutable envelope contains operation, entity, tenant, actor, session, permission, request ID,
IP, user agent, reason, before/after JSON, and a database-server operation time. Actor and envelope
values come from authenticated request context set transaction-locally, not mutation bodies.

Finance rows are append-only. Allocation inserts lock both documents, enforce tenant/currency/kind,
and check net balances. Allocation corrections are linked exact reversals. A document can be
reversed only by an exact linked record and only after its net allocations return to zero, so
concurrent allocations/reversals cannot leave an unbalanced ledger. Client bodies cannot choose
canonical `postedAt`.

## Production composition

The domain/database barrels, API adapter, route registration, error mapping, readiness, and platform
workspace are composed. The adapter creates HMAC attestations only after JWT/session validation and
binds actor, session, exact permission/action, request identity, reason, IP, user agent, optional
MFA, and a one-minute expiry. `CONTROL_CONTEXT_SECRET_BASE64` must decode to at least 32 bytes and
is injected from a secret manager in production.

Deployment order is mandatory:

1. Run `sh infra/docker/postgres/admin/bootstrap-control-center-roles.sh` as a DBA against the
   control database. It creates/repairs `orvex_control_runtime` (NOLOGIN) and `orvex_control_api`
   (LOGIN, NOINHERIT) and grants SET-only membership.
2. Run the plane-aware migration runner with `CONTROL_DATABASE_MIGRATION_URL`; migration 2100 is
   mapped to the control plane only.
3. Run `sh infra/docker/postgres/admin/provision-control-center-context-key.sh` as a DBA. Rotation
   uses a new key ID; the script refuses to replace different material under an existing ID.
4. Start the API with separate auth/control DSNs and matching key ID/secret. `/ready` fails closed
   unless migration 2100, required relations, the NOLOGIN runtime role, active context key, guarded
   function grants, and key-table denial are all verified by `control_center_readiness()`.

The platform client workspace is mounted at the existing ISP clients navigation route. Until the web
authentication/API client is added, it renders only explicitly labelled demonstration records;
unsupported create controls are not shown. Its standalone denied state remains visible and explains
that the screen cannot request or elevate access.

## Deployment and remaining validation

The migration is forward-only. After financial or audit evidence exists, rollback requires a new
corrective migration or restore; dropping these objects destroys history. Alert on approval denial,
stale revision, idempotency conflict, function authorization failure, and finance constraint errors.

Focused source tests cover domain separation/MFA, HTTP denial and timestamp rejection, Arabic enum
labels, repository error mapping, adapter signing/configuration, mounted UI filtering, readiness,
and static privilege/guard assertions. A live PostgreSQL harness still must prove migration syntax,
SET-only role behavior, direct-write denial, two-session approval, concurrent replay/collision,
package overlap races, and allocation/reversal races before release.
