# Alert ownership and drill policy

The machine-readable source is `infra/observability/alert-catalog.json`; static validation ensures
every alert has severity, threshold, owner, deduplication key and an existing runbook. Candidate
Prometheus rules are inactive until metric presence/cardinality and thresholds are validated.

- Critical pages: tenant-isolation, payment/idempotency invariant, telemetry/secret leakage.
  Preserve evidence and invoke Security/Finance incident command; do not auto-remediate destructive
  state.
- High pages: user-impacting API errors, DB saturation/locks, queue age/DLQ, missed backup, failed
  deployment smoke.
- Warning tickets: sustained latency/error-budget risk and overdue restore exercises before RPO is
  at immediate risk.
- Group by the declared safe dedup key. Never put raw tenant/subscriber IDs, phone, invoice/payment
  reference, URL query or body in an alert label/notification.
- An alert is ready only after fire, route, deduplicate, silence, recover and runbook drills are
  captured. A metric existing is not alert evidence.

The threshold catalogue is initial and must be tuned from staging plus owner-approved SLO/RPO/RTO.
Every threshold change is reviewed with its missed-incident and noise tradeoff.
