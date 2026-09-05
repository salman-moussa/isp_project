# Release exercise scripts

## Packaging integrity (wired into CI and `npm run validate`)

```sh
npm run release:packaging              # verify the committed bytes are deployable
npm run release:artifact -- --ref <sha> --out artifacts/release
```

`verify-release-packaging.mjs` inspects git **index blobs**, not the working tree, so its result
does not depend on a contributor's `core.autocrlf`. It fails on CR in a tracked text blob, a `*.sh`
without mode `100755`, a UTF-8 BOM in a migration, a migration name that is not forward-only under
the migrator's ordering, or a migration missing its database-plane scope.

`build-release-artifact.mjs` packages a commit with `git archive` — committed bytes, committed
modes, fixed mtime, dirty trees refused — and writes a manifest recording the archive digest, the
SHA-256 of every packaged migration, and every shell script's mode.

`packages/database/scripts/preflight-migrations.mjs` (shipped in the `migrate` image) compares those
migration checksums against the live `_orvex_migrations` ledger before any container is recreated.
It is read-only and never edits the ledger; a mismatch is a packaging defect to fix in the artifact.

## Backup, restore, and rollback exercises

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
