# Network Worker production composition

Status: implementation-ready contract; the SQL contract still requires a reviewed tenant-plane
migration and live PostgreSQL evidence before production rollout.

Requirement coverage: NW-SEC-001 (secret references), NW-EGR-001 (allowlisted TLS egress),
NW-IDEMP-001 (idempotent commands), NW-REC-001 (uncertain-result reconciliation), and NW-DLQ-001
(durable retry/dead-letter handling).

## Composition hook

`createProductionNetworkWorker` in `workers/network-worker/src/production/factory.ts` returns the
existing `NetworkWorker`. The service composition root must provide:

- a `ParameterizedSqlClient` connected with a runtime role granted execute only on the reviewed
  `network_worker` functions;
- a unique, stable worker instance ID;
- an exact list of RouterOS HTTPS origins including explicit ports;
- a `SecretReferenceResolver` backed by the deployment secret manager; and
- bounded timeouts, concurrency, circuit-breaker, and retry settings.

The composition root can pass the result as the `runner` to `startNetworkWorkerService`. It must not
read credentials into environment variables or register the simulator in configured mode.

## PostgreSQL contract

`workers/network-worker/src/production/network-store-contract.sql` is a reference fixture, not an
applied migration. Promote it through the normal timestamped tenant migration process after review.
Its security-definer functions are the only expected runtime surface. Revoke direct table access.

The contract provides:

- atomic `(tenant_id, idempotency_key)` insertion with payload-conflict rejection;
- `FOR UPDATE SKIP LOCKED` claim ordering;
- lease ownership and an unguessable lease token;
- expired `running` lease reclamation after worker death;
- compare-and-save semantics that reject stale workers;
- persisted state, attempts, availability, desired and observed envelopes; and
- indexed retry/reconciliation claims and bounded dead-letter reads.

The existing `NetworkWorker` records every attempt in the job JSON, schedules retry or
`reconciling`, compares observation with desired state before retrying destructive actions, and
persists terminal dead letters. Operators must treat a dead letter as a manual investigation, never
as permission to issue an untracked router command.

## RouterOS REST boundary

`RouterOsRestAdapter` uses the built-in Fetch API and the official RouterOS REST `/rest` resource
model. Controls are deliberately narrow:

- HTTPS is mandatory. Endpoint credentials, base paths, queries, fragments, redirects, and hosts
  outside the exact origin allowlist are denied.
- Only PPP secret observation/create/update and active-session disconnect paths can be generated.
  Router resource IDs must match a strict allowlist before entering a path.
- Basic credentials and subscriber passwords are resolved just-in-time from `secret://` references.
  Returned outcomes and thrown safe errors never include a credential, response body, URL, or
  underlying transport message.
- Request timeouts use abort signals. A timeout or transport failure during a mutation is
  `uncertain`; reconciliation observes before any retry.
- Response bodies and record counts are bounded. JSON values, field names, identifiers, and required
  PPP fields are schema-checked.
- HTTP authentication/authorization and other 4xx rejections are definite failures. 5xx/transport
  responses are uncertain because the command may already have applied.

Only `routeros-rest` registrations are accepted. RouterOS API socket support needs a separate,
equally constrained adapter; do not silently route it through REST.

## Deployment and rollback

1. Review and promote the SQL contract as a tenant-plane migration, then grant only function execute
   to the Network Worker runtime role.
2. Configure exact management-network HTTPS origins and firewall egress to the same endpoints.
3. Provision least-privilege RouterOS users and store their values in the secret manager.
4. Wire the production factory into configured mode and run live tests against a disposable RouterOS
   lab instance.
5. Start one worker at concurrency one per router, monitor lease expiry, retry age, uncertain jobs,
   and dead-letter growth, then scale horizontally.

Application rollback may stop workers safely; leases expire and jobs remain durable. The schema is
additive and should not be dropped during rollback. Reverting a successfully applied network change
requires a new, audited, idempotent compensating command.

## Evidence captured

Focused tests cover parameter binding, lease-token compare-and-save, stale-lease rejection,
allowlisted origins and paths, Basic-auth redaction, timeout classification, uncertain transport
outcomes, response size/schema rejection, and observed-state reconciliation. Live PostgreSQL and
RouterOS lab tests remain required deployment evidence.
