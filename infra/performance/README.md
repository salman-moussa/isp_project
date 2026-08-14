# Local performance harness

This dependency-free Node 22 harness provides bounded HTTP preparation for Phase G. Its default
target is `http://127.0.0.1:3000`; remote targets are denied unless the exact non-production host is
allowlisted. Scenarios are read-only and intentionally do not model payment, mobile-sync, billing,
or network correctness yet.

```powershell
node infra/performance/validate.mjs
node infra/performance/run-load.mjs --scenario local-smoke --out outputs/performance/local-smoke.json
```

The output path uses exclusive creation so earlier evidence is never silently overwritten. For an
authorized HTTPS staging target set both `ORVEX_LOAD_ACK=authorized-nonproduction-target` and
`ORVEX_LOAD_ALLOW_HOSTS=staging.example.internal`. Runs over 30 minutes also require
`ORVEX_LOAD_EXTENDED_ACK=authorized-extended-staging-run`. Authentication headers may be supplied at
runtime through `ORVEX_LOAD_HEADERS_JSON`; the harness never records them.

The eight-hour scenario is an executable scaffold, not a measured result. Before it becomes release
evidence, add tenant-safe authenticated read routes and separate correctness drivers for duplicate
payment keys, offline sync, billing, and router jobs. Record hardware, database size, connection
limits, commit, artifact digest, monitoring snapshots, and invariant-query results alongside the
harness JSON.
