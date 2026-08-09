# ADR-0005: Events, idempotency and asynchronous jobs

- Status: Proposed
- Date: 2026-08-09
- Deciders: Architecture, Backend, Network, SRE
- Requirements: PRD-API-001, PRD-NFR-003..004, PRD-NET-005..007, PRD-INT-002
- Risks: RSK-002, RSK-005, RSK-013

## Context

Finance, mobile sync, provider webhooks, provisioning, documents and network jobs must tolerate
duplicate delivery, worker restart and partial failure. Exactly-once distributed execution is not a
realistic transport guarantee.

## Decision

Use owning-database transactional outbox plus consumer inbox/effect records. Transport is
at-least-once. Events contain immutable event ID, aggregate/type/version, schema version, verified
plane/tenant scope, occurred/recorded times, request/trace ID and minimal safe payload. Consumers
reserve `(consumer, event_id)` and apply effects atomically; duplicates return the prior result.

Mutating public/mobile/internal commands that can repeat require an idempotency key. The same
scope+operation+key and normalized request hash returns the canonical prior result; a different hash
returns conflict. Provisioning and batch workflows use persisted step state and deterministic
resource keys.

Jobs are durable state machines with leases/heartbeats, bounded exponential backoff+jitter,
deadlines/timeouts, attempt classification, circuit/concurrency controls as needed, cancellation
only at safe points, DLQ and authorized replay. Unknown outcome is distinct from known failure.
Business records do not depend on broker history for audit.

Event schemas are backward-compatible by default. Consumers ignore additive fields, reject
unsupported major schema versions visibly, and replay tooling is scoped, permissioned and audited.

## Consequences

- Side effects converge reliably but are eventually consistent and UIs must expose pending/freshness
  states.
- Outbox relay/inbox retention, lag and replay become operational responsibilities.
- Idempotency records for financial effects require long retention and payload-hash privacy.
- No cross-database atomic illusion; compensating/repair workflows are explicit.

## Rejected alternatives

- Direct publish after commit: can lose events between commit and publish.
- Publish before commit: can expose rolled-back state.
- Broker “exactly once” as sole guarantee: does not cover external/database side effects.
- Unlimited automatic retries: causes storms and unsafe repeated effects.

## Validation

Kill/restart between every transaction/publish/consume boundary; duplicate/reordered delivery;
same-key different-payload conflict; outbox backlog/replay; DLQ authorization; provider webhook
replay; billing retry-only-failed; network uncertain-result state; correlation and PII-safe event
schema review.
