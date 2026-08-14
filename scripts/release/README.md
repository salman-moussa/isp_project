# Release exercise scripts

These scripts are intentionally outside the root npm manifest until the integration owner adds the
reviewed CI hooks. They require Node 22 and external PostgreSQL client/`age` binaries for recovery
work. Database access uses a libpq service entry (`PGSERVICE`/`PGSERVICEFILE`) so credentials are
not placed in command arguments or evidence.

Run static validation:

```powershell
node scripts/release/validate-phase-g.mjs
```

Backup requires `ORVEX_BACKUP_ACK=encrypted-backup-authorized`, a safe scope/output directory, a
libpq service name and an age **public** recipient. It verifies the custom archive before
encrypting, deletes plaintext, and creates a manifest that explicitly marks off-host and restore
verification false.

Restore requires `ORVEX_RESTORE_ACK=isolated-nonproduction-restore-authorized`; the target database
must start `orvex_restore_exercise_`. It verifies checksum/decryption/listing and retains the
restored database for domain reconciliation and compatible application smoke. It does not call a
drop command.

Rollback rehearsal requires existing schema-compatibility and before/after smoke evidence plus exact
artifact digests. It records checksums but cannot deploy or roll back a database. External
deployment authorization and provider-specific commands remain separate.
