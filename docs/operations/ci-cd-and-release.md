# CI/CD and release guide

## Pipeline model

Pull requests run bootstrap detection, lockfile install, formatting/lint/type/static checks,
unit/component/database/API/contract tests, builds, accessibility/RTL gates and security scans as
applicable. Release candidates additionally build immutable containers, generate SBOM/provenance,
scan artifacts, validate migrations, deploy the exact digest to staging, run smoke/E2E/DAST and
require manual production approval.

The bootstrap workflows skip cleanly only when no root Node manifest exists. Once a manifest exists,
a missing `package-lock.json` is a failure. Optional scripts are detected without running arbitrary
package lifecycle code; required script policy should tighten as each phase lands.

## Protected delivery rules

- Default branch requires review, resolved conversations and all applicable checks.
- GitHub workflow permissions default to read-only. Deployment uses protected environments and
  short-lived OIDC identity; no long-lived cloud key in repository secrets.
- Third-party actions use reviewed major versions during Phase 0; pin exact commit SHAs before
  production and update through reviewed automation.
- Artifacts are named with semantic version, commit SHA and content digest. Build once; promote the
  same digest.
- Production deployment is a manually approved environment job, never a `pull_request_target`
  execution of untrusted code.
- Failed security/test gates are not hidden by `continue-on-error`.

## Release sequence

1. Freeze the candidate commit and publish release notes, known risks, feature flags and
   owner-approved change window.
2. Verify required scans/tests, SBOM, signatures/attestations, image digest and configuration diff.
3. Preview backward-compatible expand/migrate/contract migrations and restore compatibility. Confirm
   no destructive automatic down migration. For an existing database volume that already has the
   Orvex migration ledger but predates the finance audit relay roles, a DBA must first run
   `infra/docker/postgres/admin/bootstrap-finance-audit-relay-roles.sh` once per control and tenant
   database. Supply a privileged `DATABASE_BOOTSTRAP_URL` and the relay password through the secret
   manager. This roles-only bootstrap does not adopt or mutate the application schema; run the
   normal forward migration only after it succeeds. Do not use the legacy adoption bridge on an
   already-migrated database.
4. Confirm recent backup health and whether this release requires a new pre-deploy backup. A
   dashboard state is not a restore test.
5. Deploy the digest to staging; run readiness, smoke, critical E2E, migration and DAST; record
   evidence.
6. Obtain security, operations and product approvals. Deploy with rolling/blue-green or controlled
   recreate according to topology.
7. Run post-deploy smoke and health checks, compare golden signals and business invariants, then
   monitor through the defined observation window.
8. Promote or halt feature flags separately. Complete contract migrations only after all old
   binaries/jobs are retired and rollback window has closed.

## Release packaging integrity (cross-platform byte safety)

A production deployment on 2026-09-04 failed after services were stopped because the release
artifact was assembled from a Windows checkout. Two defects reached the host together:

- Historical migration files were **content-identical but CRLF-terminated**. The migrator hashes raw
  migration bytes, so every applied migration produced a new SHA-256 and the run aborted with
  `Applied migration ... has changed`. Recovery required restoring the backed-up historical bytes.
- The `infra/docker/postgres/admin` shell scripts lost their executable bit and could not run inside
  Alpine, so context provisioning failed. They had to be restored with LF endings and mode `0755`.

Neither defect is visible to lint, typecheck or tests. Four controls now prevent recurrence:

1. **`.gitattributes`** declares `* text=auto eol=lf` and pins `*.sql`, `*.sh`, `*.mjs` and `*.yml`
   to `text eol=lf`. Git normalizes at staging time, so CRLF can no longer enter the index
   regardless of a contributor's `core.autocrlf` setting.
2. **`npm run release:packaging`** (`scripts/release/verify-release-packaging.mjs`) asserts the
   committed blob bytes rather than the working tree: no CR in any tracked text blob, mode `100755`
   on every `*.sh`, no UTF-8 BOM in a migration, forward-only migration names under the migrator's
   exact ordering, and a valid database-plane scope for every migration. It runs as a dedicated CI
   job and inside `npm run validate`.
3. **`npm run release:artifact -- --ref <sha>`** builds the deployable tarball with `git archive`,
   which emits committed bytes and committed modes and refuses a dirty tree. The manifest records
   the archive digest, the SHA-256 of every packaged migration and every shell script's mode.
4. **`packages/database/scripts/preflight-migrations.mjs`** compares packaged migration checksums
   against the live `_orvex_migrations` ledger **before any container is recreated**, and exits
   non-zero on a checksum mismatch, a migration applied in production but missing from the artifact,
   or a new migration that sorts before one already applied. It ships in the `migrate` image, so it
   runs on the host with the same DSNs the migrator uses.

Applied migration files are immutable: never rewrite, rename, renumber or delete one, and never edit
a stored checksum in `_orvex_migrations` to make a mismatch disappear. A mismatch is a packaging
defect to fix in the artifact. Only new forward migrations are ever promoted.

`deploy/production/deploy-checkpoint.sh` sequences the whole production checkpoint: authorization,
read-only preflight, backup with verified SHA-256 sums, checkout, packaging verification, image
build, migration preflight, migration and provisioning, workers and API before web, endpoint and
database-invariant verification, and a checkpoint report. Everything before the migration phase is
non-mutating, so an aborted deployment leaves the previous release serving traffic untouched.

## Required release record

Use `release-evidence-template.md`. It captures commit/artifact/image/SBOM digests, environment/IaC
revision, tests/scans, migration and backup decisions, approvals, timestamps, smoke/telemetry,
incidents, rollback decision and known limitations. A plan, green badge or author statement is not
sufficient evidence.

## Deployment strategy

Shared hosted targets rolling or blue/green workloads with tenant-aware canaries and strict
migration compatibility. Dedicated hosted may use rolling or controlled recreate based on capacity
and accepted maintenance. Self-hosted receives signed artifacts, checksums, compatibility/preflight
tooling and operator-run instructions; vendor automation must not assume infrastructure access.
