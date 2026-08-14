# Runbook: database saturation or lock wait

Owner: SRE/DBA on-call. Freeze rollout and new maintenance/backfill work. Capture connection/pool
wait, active transaction age, locks/blockers, statement class, CPU/I/O/WAL/storage and recent
migration/job changes using sanitized queries. Do not terminate an unknown financial/network
transaction or expose SQL values in incident channels.

Apply admission backpressure and pause low-priority job claims. Scale consumers only if PostgreSQL
has measured headroom. A DBA may cancel a reviewed safe blocker; preserve evidence and keep
idempotent work durable. Verify pool/security context after recovery, finance invariants, relay
backlog drain and API SLO for two windows. Escalate storage/WAL or integrity risk to incident
command.
