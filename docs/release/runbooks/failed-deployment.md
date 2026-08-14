# Runbook: failed deployment or smoke

Owner: Release on-call. Stop the rollout wave, preserve failed version/config/migration/telemetry
and pause risky new jobs while leaving accepted durable work intact. Determine whether failure is
artifact, configuration, dependency, schema compatibility, data write or capacity related.

If no incompatible data/schema change occurred, redeploy the recorded schema-compatible prior digest
and run readiness plus finance/operations/control smokes. Never auto-run a down migration or restore
over post-deploy writes. Otherwise convene DBA/domain incident command for data-forward repair or an
explicit RPO restore decision. Resume promotion only after root cause, smoke, alert recovery and all
tenant waves are reconciled.
