# Monitoring baseline

`prometheus-alerts.yml` is a provisional contract for application instrumentation. Reconcile metric
names, labels and histogram buckets against emitted telemetry, replace the runbook base URL, run
`promtool check rules`, and test delivery/deduplication in staging before enabling paging.

Metrics must use bounded labels and tenant-safe identifiers. Do not add subscriber IDs, document
IDs, request IDs, URLs, error text, email, phone, payment reference or router credentials as labels.
Traces/logs carry request correlation under the redaction rules in
`docs/operations/observability-slos-alerts.md`.

No dashboard screenshot, alert rule file or successful syntax check proves that telemetry is emitted
or pages reach on-call. Retain a dated staging alert exercise as evidence.
