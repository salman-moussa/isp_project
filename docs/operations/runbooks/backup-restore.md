# Backup and restore runbook

## Backup failure

1. Acknowledge alert, identify exact environment/scope, last successful verified backup and forecast
   RPO breach.
2. Check repository reachability/capacity, backup identity/KMS access, database/object health and
   manifest/checksum failure without printing secrets.
3. Correct the narrow fault and run a new backup. Do not delete older recovery points to make space
   without retention-owner approval.
4. Verify manifest/checksum and monitoring. If RPO is breached or encryption/repository integrity is
   uncertain, raise SEV-2/SEV-1.

## Isolated restore exercise

1. Approved ticket states control/tenant/object scope, point in time, target RPO/RTO, restore owner,
   independent approver and synthetic or authorized data handling.
2. Confirm source manifest identity, checksums, schema/app version, encryption-key reference and
   isolated target network/account. Reject tenant/environment mismatch.
3. Provision a fresh target from reviewed IaC. Prevent outbound messaging, live payments/provider
   calls and router access.
4. Restore database, audit and objects using least-privilege restore identity. Capture start/end UTC
   and tool versions.
5. Deploy a compatible artifact; run schema/integrity checks, tenant-isolation negatives, finance
   balances/counts, object sampling, auth and critical smoke tests.
6. Calculate actual recovery point and duration; compare with accepted objectives. Record failures
   and remediation.
7. Destroy or retain the isolated environment according to approved evidence/retention policy;
   revoke temporary access. Never call the exercise successful without the checks above.

Production cutover after disaster is a separate incident-command decision with communication,
DNS/traffic, credential rotation and rollback points.
