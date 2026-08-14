# Backup, restore, disaster recovery and rollback exercises

Status: scripts and evidence templates prepared; no backup, restore, RPO/RTO or rollback result is
claimed. The scripts in `scripts/release` require explicit non-production acknowledgements and use
libpq service names so database passwords are not placed in process arguments.

## Backup policy contract

- Scope control DB, each tenant DB, global/audit records, object storage, deployment configuration
  and secret-manager references/rotation metadata. Secret values are backed up only through the
  approved secret manager recovery mechanism.
- Use PostgreSQL custom-format logical backup for portable exercises plus provider-native physical/
  WAL PITR when selected. Backups are compressed, encrypted before leaving the host, checksummed and
  copied to an access-separated off-host account/bucket with immutability where supported.
- Encrypt object/config manifests and record object version/checksum. Never include `.env`,
  credentials, private age keys or plaintext exports in release evidence.
- Retention, RPO, RTO, region and legal deletion are owner decisions. Candidate exercise cadence:
  nightly logical/control+tenant coverage, continuous PITR where available, monthly representative
  restore and quarterly full-environment recovery; do not activate until accepted/costed.
- A scheduled job is successful only when archive listing/decrypt/checksum and off-host object
  receipt pass. Backup age, bytes, duration and failures are metrics with opaque scope keys.

## Isolated restore exercise

1. Open an exercise record with backup artifact/checksum, source recovery point, accepted isolation,
   expected relation/object counts, abort owner and no-real-provider controls.
2. Provision a clean isolated network/account. Deny outbound provider/messaging/router endpoints and
   use synthetic credentials. Restore targets must begin `orvex_restore_exercise_`.
3. Verify encrypted archive checksum, decrypt to a restricted temporary directory, list it with
   `pg_restore`, create the empty exercise database and restore without owners/privileges.
4. Apply/bootstrap only the reviewed roles/config required for the restored version. Do not silently
   migrate before testing the recovery point; first test with its compatible artifact.
5. Reconcile migration set, relation row counts, financial totals/invariants, audit/outbox sequence,
   tenant sentinels, object count/checksum and configuration references.
6. Start the exact compatible application artifact against the restored control + representative
   tenant + object store. Run readiness and authenticated control/tenant finance/operations/document
   verification smokes with all external side effects disabled.
7. Measure recovery point against the incident time (RPO) and declaration-to-smoke-ready duration
   (RTO). Record bottlenecks and unresolved scopes. A SQL `SELECT 1` is readability evidence, not an
   application restore pass.
8. Preserve evidence, securely remove plaintext temporary files, then destroy only the explicitly
   named exercise environment after approval.

Exercise matrix: control plane alone; one shared tenant; dedicated tenant; object/files alone;
audit; and full environment including routing/config. Each is independently reported.

## Application rollback and data-forward recovery

Rollback redeploys a previously scanned/signed immutable digest that is compatible with the current
expanded schema. It never runs an automatic down migration or restores a database over post-deploy
writes. Before deployment, prove current and previous artifacts can operate with the expand schema,
then record the last point where the wave can stop without data repair.

On smoke/SLO failure: stop the rollout, preserve evidence, stop risky job intake, keep accepted
durable work, evaluate schema/data writes, and either redeploy the prior compatible artifact or roll
forward a fix. If a destructive/data-corrupting migration occurred, incident command chooses forward
repair or an isolated restore/failover with an explicit accepted-loss window; automation does not
decide.

The rollback rehearsal script validates evidence inputs and emits a rehearsal record. Actual
orchestrator commands remain profile/provider-specific and require deployment authorization.
