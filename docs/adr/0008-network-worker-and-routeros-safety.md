# ADR-0008: Isolated network worker and RouterOS safety

- Status: Proposed — production adapter requires representative lab validation
- Date: 2026-08-09
- Deciders: Network, Security, Architecture, ISP Operations
- Requirements: PRD-BND-004, PRD-NET-001..009
- Risks: RSK-003, RSK-005, RSK-006, RSK-013

## Context

RouterOS commands affect real connectivity, use powerful secrets and may time out after taking
effect. Bulk commands can cause mass outage. Platform commercial restriction must be incapable of
producing Subscriber network actions.

## Decision

Only the isolated network process under `workers` communicates with RouterOS/site connectors. It has
no public ingress, accepts a narrow authenticated internal job contract, resolves credential
references at runtime and has egress only to configured endpoints. `apps/api` owns
authorization/approval, immutable batch preview, desired state and durable job; the worker owns
adapter invocation, attempt classification, observation and result updates.

Network mutations use deterministic target+operation+desired-state hashes/idempotency keys, bounded
timeouts/retries with jitter, per-router mutation concurrency default 1, circuit breaker and DLQ.
Known transient failure may retry; known permanent failure stops; timeout/disconnect after send is
`reconciliation_required`. For uncertain outcome, observe actual state and compare desired/before
state before any authorized retry.

Bulk operations freeze an exact target/exclusion/impact snapshot and create one job per Subscriber,
permitting partial result/retry only for classified safe failures. High-impact commands require
step-up, reason and approval policy. Credentials/secrets never enter web/mobile/job
payload/log/trace/error/export/support views.

The network command ingress accepts only tenant-domain commands (`InternetService...`,
`SubscriberPaymentPosted` eligibility workflow) on an allowlist. Control-plane Platform Subscription
events are a forbidden dependency and cannot enqueue network jobs.

A provider-neutral adapter and simulator are mandatory. Production library/protocol selection
follows maintenance/security review and lab tests across supported RouterOS versions/topologies.

## Consequences

- Safer failure domain and egress/secret controls; introduces internal contract and eventual state.
- Observed state needs freshness and bounded polling/storage.
- Some jobs intentionally pause for human/reconciliation rather than maximizing automatic retry.
- Site connectivity varies; connector deployment/ownership becomes an operational prerequisite.

## Rejected alternatives

- Router calls inside HTTP requests: timeouts, secrets and retries unsafe.
- Credentials/browser direct calls: prohibited.
- Retry every timeout: can repeat destructive commands.
- One giant bulk router script without child records: inadequate preview/audit/recovery.
- Platform subscription consumer in network domain: violates critical boundary.

## Validation

Simulator matrix for success, timeout before/after send, partial, offline, auth failure, throttling,
stale/clock mismatch, worker restart and circuit recovery; duplicate job and per-router ordering;
bulk approval/impact/partial/retry; secret redaction/egress; architecture and E2E negative test
proving Platform Subscription restriction emits no network job.
