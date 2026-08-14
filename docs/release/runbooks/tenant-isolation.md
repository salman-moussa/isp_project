# Runbook: tenant-isolation signal

Owner: Security incident commander. A high-confidence cross-tenant read/write/cache/file/queue/audit
or support-access bypass is critical. Contain the affected route/worker/deployment while preserving
logs, traces, audit and database evidence. Revoke relevant sessions/support grants and rotate
exposed keys; do not broadly query subscriber PII for triage.

Establish affected planes/opaque tenants through security-controlled queries, notify only through
the approved legal/incident process, and fix the boundary plus every equivalent path. Resume only
after live PostgreSQL isolation/pool-reuse tests, authorization matrix, cache/object/queue sentinel
scans, independent security review and documented impact.
