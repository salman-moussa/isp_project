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
