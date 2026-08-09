# ADR-0010: Observability, SLOs and telemetry data safety

- Status: Proposed
- Date: 2026-08-09
- Deciders: SRE, Security, Architecture, Domain Owners
- Requirements: PRD-OPS-005, PRD-NFR-001..004, PRD-BND-005
- Risks: RSK-006, RSK-012, RSK-015, RSK-019

## Context

Critical failures span payments, billing, mobile sync, network jobs, deployments, backups and
isolation. Platform staff need actionable aggregate health without Subscriber PII. Logs alone do not
provide causal visibility, and unrestricted telemetry can leak secrets/data.

## Decision

Use OpenTelemetry-compatible structured logs, metrics and traces with propagated request/trace IDs
across HTTP, outbox, queue, worker and adapter boundaries. Define a semantic attribute allowlist:
service/version/environment, route/operation, status/error class, duration, job/event type, opaque
deployment/tenant correlation and provider/router opaque ID where necessary. Exclude names, phones,
national IDs, addresses, credentials/tokens, proof/document content, free-form notes and raw
request/response bodies. Redaction is centralized and tested.

Define SLIs/SLOs and error budgets for API availability/latency, financial posting
correctness/availability, mobile sync age, billing duration, network queue/outcome, projection
freshness and backup/restore. Initial objectives and reference load are in
[capacity and performance](../architecture/capacity-and-performance.md); owner acceptance is
pending. Dashboards separate control/fleet aggregates and tenant-authorized views.

Alerts require severity, owner, threshold/window, deduplication, runbook and safe context. Page on
user-impacting symptoms/invariants, not every retry. High-confidence isolation/payment
integrity/secret events are critical and preserve evidence. Telemetry access/export is
role-controlled and audited; retention is tiered.

## Consequences

- Better correlation and operations without broad raw-data access.
- Attribute governance and cardinality budgets constrain ad hoc debugging; approved support access
  retrieves domain evidence instead.
- SLOs need tuning after staging/production baselines and business acceptance.
- Async correctness requires business-level metrics plus traces, not transport success alone.

## Rejected alternatives

- Log full payloads “for debugging”: unacceptable PII/secret exposure.
- Platform dashboards reading tenant operational DBs: violates tenant boundary.
- Alert on every error/retry: noisy and unactionable.
- Vanity uptime without correctness/queue/restore indicators: misses core risks.

## Validation

Telemetry contract/redaction tests with seeded sentinel secrets/PII; trace continuity through
outbox/worker; metric-cardinality load; dashboard permission/aggregate privacy review; alert
fire/dedupe/recover/runbook drills; SLO calculation tests; no raw tenant PII in platform health or
central traces.
