# Runbook: telemetry PII/secret leakage

Owner: Security + SRE. Stop the emitting service/export path while preserving an access-restricted
sample and time range. Revoke/rotate any credential or signed URL. Restrict backend access, exports
and retention actions; do not copy the leaked value into tickets, chat, alert labels or new logs.

Identify all replicas/archives and follow approved deletion/legal-hold procedures. Fix the
application serializer/allowlist first and Collector defense second. Re-run every forbidden-class
sentinel through success/error/worker paths and scan all sinks. Resume only with zero matches,
reviewed backend cleanup, bounded cardinality and Security approval.
