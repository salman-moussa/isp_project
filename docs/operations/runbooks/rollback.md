# Deployment rollback runbook

Rollback is an explicit operator decision, not an automatic database reversal. Prefer feature
disable or forward fix when newer writes are incompatible with the old artifact.

## Preconditions

- Incident/change owner confirms failing digest, last known-good digest, affected services and
  rollback trigger.
- Review schema compatibility, configuration/secrets, queued job/event formats, object formats and
  network-worker protocol.
- Confirm the previous artifact remains scanned/available and current data is readable by it. If
  uncertain, stop and use a reviewed forward-fix/recovery plan.

## Procedure

1. Pause rollout and unsafe workers/jobs; preserve telemetry and migration state.
2. Disable risky flags/integration live modes if that safely contains impact.
3. Shift traffic to the last compatible immutable artifact (blue/green) or redeploy it with
   controlled recreate/rolling policy.
4. Roll back configuration only to a version compatible with current data and secret versions.
5. Do **not** execute destructive database down migrations. Expand artifacts remain; data repair or
   contract rollback needs an approved bespoke plan and backup.
6. For the network worker, stop new commands, retain durable job/attempt state, deploy the
   compatible worker and reconcile uncertain jobs before resume.
7. Run readiness and smoke: authentication, tenant boundary, permitted read, idempotent payment test
   on synthetic scope, queue/object access, audit and network simulator/health.
8. Restore traffic/workers gradually and monitor. Record deployed digest, decision, commands,
   timestamps and results.

If rollback fails, keep the narrow unsafe path disabled, escalate severity and choose forward fix or
disaster recovery. Never declare success from process health alone; validate business invariants.
