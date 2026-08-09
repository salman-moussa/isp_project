# Credential compromise runbook

1. Declare security incident; identify credential class, environment, owner, permissions, suspected
   exposure/usage window and dependent services. Preserve repository/CI/cloud/audit metadata without
   copying secret values.
2. Contain: revoke/disable the exposed credential or narrow its permissions and block observed
   abuse. For signing/encryption credentials, coordinate compatibility/data-recovery before
   rotation. Do not lock out recovery identities.
3. Search sanitized access/audit logs for use, privilege changes, data access, new credentials,
   deployments and persistence. Expand scope to derived secrets (tokens issued by a signing key,
   database contents reachable by a credential).
4. Generate a new credential in the secret manager, update references/runtime, verify health, then
   revoke overlap. Never paste it into commands that echo, tickets or chat.
5. Rotate affected sessions, webhook/provider/router/database/object/backup credentials according to
   scope. Treat any committed secret as compromised even if quickly deleted; scan history and
   forks/caches where applicable.
6. Verify tenant/financial/network integrity, alerting and least privilege. Document timeline,
   access evidence, rotation/revocation IDs, affected tenants/data assessment and follow-up.

Notification and breach determinations belong to authorized leadership/counsel. Do not make
unsupported statements about access or impact.
