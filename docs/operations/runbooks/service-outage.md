# Service outage runbook

1. Declare severity and roles using `incident-management.md`. Identify environment, services,
   tenants/regions and start time.
2. Check recent release/config/flag/secret/certificate changes, edge health, API golden signals, DB
   connections/locks/storage, Redis/queue oldest age, object health and provider status.
3. Prefer reversible containment: halt rollout, disable a faulty feature/provider, scale within
   capacity, isolate poison jobs, or route to healthy instances. Do not repeatedly restart before
   preserving logs/metrics and understanding queue semantics.
4. If the current artifact is causal and data remains compatible, follow `rollback.md`. If
   migration/data is suspect, stop writes for the narrow scope and engage database/recovery owner;
   never run destructive down migrations automatically.
5. Verify `/health/live` and `/health/ready`, authentication, tenant isolation sample, payment
   read/write idempotency, queue progress, object access and network-worker safety before restoring
   traffic.
6. Drain backlog by priority with rate limits. Reconcile payments, webhooks, mobile operations and
   uncertain MikroTik jobs; do not blind-replay.
7. Observe error budget, saturation and business outcomes through the defined window; communicate
   recovery and residual impact.

Capture alert, dashboards, traces, release/config digests, commands, job IDs, affected scope,
timeline, decisions and follow-up. Redact PII and secrets.
