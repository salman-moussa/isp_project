# Observability preparation

`otel-collector.yaml` is an OpenTelemetry Collector Contrib preparation profile with memory limits,
defense-in-depth resource/attribute deletion, structured-log enforcement, batching, TLS upstream
export, Prometheus export, and health telemetry. It is not wired into the application or Compose
yet. Pin and scan a Collector Contrib image, then validate this configuration with that exact
binary.

The application remains responsible for the allowlist in `docs/release/observability-contract.md`.
Collector redaction is a second barrier, not permission to emit sensitive payloads. Upstream
endpoints and credentials are injected at runtime; no debug exporter is present because it can
expose data.

`prometheus-rules.yml` contains inactive metric contracts and candidate thresholds. Instrumentation,
cardinality, owner acceptance, alert fire/recover/dedup drills, and staging tuning are required
before activation. Run `node infra/observability/validate.mjs` for static catalog/runbook checks.
