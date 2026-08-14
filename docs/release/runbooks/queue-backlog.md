# Runbook: queue/relay backlog or dead letter

Owner: the named workload team with SRE. Identify queue, oldest age, throughput, error class,
affected opaque tenant count, downstream saturation and last known-good version. Stop claiming work
if the downstream database/provider/router is unhealthy; accepted durable commands remain visible.

Do not bulk replay unknown-outcome network or payment effects. Isolate poison events and use an
audited, scoped replay only after idempotency/effect-state verification. Restore tenant fairness
before adding concurrency. Recovery requires oldest age below objective, no unexpected
duplicates/loss, business invariant checks and a documented disposition for every DLQ item.
