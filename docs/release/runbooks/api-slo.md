# Runbook: API error/latency SLO

Owner: Core API on-call. Preserve the safe alert labels and trace window. Confirm user impact with
synthetic health/authenticated probes, split error/latency by normalized route, version and
dependency, and compare event-loop/RSS, DB pool wait/locks and relay/queue age. Never add raw
request bodies or subscriber data to telemetry.

Stop the deployment wave if correlated. Shed exports/reports before correctness-critical work;
reduce admission rather than increase DB consumers when the database is saturated. Roll back only to
a schema-compatible digest under the failed-deployment runbook. Validate recovery for two alert
windows, run domain smoke, record cause/evidence and create a follow-up for threshold tuning.
