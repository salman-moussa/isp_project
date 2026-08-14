# Runbook: missed backup or restore failure

Owner: SRE backup on-call. Identify scope and last successful encrypted off-host recovery point,
verify monitoring time/source, storage/KMS access, archive checksum/listing, WAL continuity and
capacity. Do not overwrite or delete the last good copy and never paste keys or database URLs into
incident records.

Retry only to a new immutable object/key after classifying the failure. If RPO is threatened, page
the incident owner and reduce risky changes. A restore failure stays open until an isolated fresh
target passes decrypt/checksum, database/object reconciliation and compatible application smoke.
Record actual RPO/RTO and update capacity/retention; a successful scheduled job alone does not close
restore risk.
