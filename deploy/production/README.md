# Orvex ISP production deployment

This Compose project is isolated from other host workloads. It publishes no direct host ports and
joins the existing `coolify` proxy network only from the web gateway. The public routes are:

- `https://isp.mosesgr.com/` — tenant workspace
- `https://isp.mosesgr.com/control/` — platform Control Center
- `https://isp.mosesgr.com/v1/*` — API
- `https://isp.mosesgr.com/ready` — readiness

Create `.env` from `.env.example` with generated secrets, then run:

```sh
docker compose --env-file .env -f deploy/production/docker-compose.yml up -d --build
```

Migrations and signing-key provisioning run as one-shot prerequisites. Public readiness covers the
API databases, finance audit relay, and durable Network Worker. The worker starts fail-closed with
no RouterOS credential mapping; activate a router only after mounting secret files below
`/run/secrets`, setting its allowed HTTPS origin, and completing the RouterOS acceptance checklist.
Authentication delivery is deliberately fail-closed until an approved HTTPS OTP/recovery provider
replaces the placeholder URL. Bootstrap user credentials must be created through the DBA-controlled
release procedure and must not be committed.

## Deploying one checkpoint

`/opt/orvex-isp` is a plain extracted tree, not a git checkout, so a checkpoint is deployed from an
immutable artifact rather than a `git pull`. Build it locally from a pushed commit, upload it, then
run the script:

```sh
# locally
npm run release:artifact -- --ref <full-40-char-commit-sha> --out artifacts/release
scp artifacts/release/<sha>.tar root@194.163.175.241:/opt/orvex-releases/

# on the host
ORVEX_DEPLOY_ACK=production-checkpoint-authorized \
  /opt/orvex-isp/deploy/production/deploy-checkpoint.sh <sha> /opt/orvex-releases/<sha>.tar
```

Phases, in order. Everything before phase 6 is read-only or staged, so an abort leaves the previous
release serving traffic untouched:

0. **Authorization** - explicit acknowledgement, a full commit SHA (never a branch), an uploaded
   artifact, and a confirmed `/opt/orvex-isp/.env`, which is preserved and never regenerated.
1. **Read-only preflight** - free disk space, current `/ready`, current container state, and a valid
   Compose model for project `orvex-isp-prod`.
2. **Stage** - unpack the artifact into `/opt/orvex-releases/<UTC>-<sha7>` and verify it carries
   executable, LF-only shell scripts. The live tree is not touched.
3. **Backup** - source archive, `.env`, historical migration bytes, `pg_dump -Fc` of both databases,
   and both migration ledgers into a new `/opt/orvex-backups/<UTC>-<sha7>`, verified with
   `sha256sum -c`.
4. **Reconcile migrations** - for every migration name already in `_orvex_migrations`, the live
   file's bytes are copied over the staged copy. See the warning below. Only genuinely new forward
   migrations come from the artifact, and they are listed.
5. **Migration checksum preflight** - build the `migrate` image from the staged tree and compare
   every applied migration against the live ledger **while the previous release is still running**.
   A mismatch aborts here, at zero downtime.
6. **Publish** - copy the staged tree over `/opt/orvex-isp`. First mutating step.
7. **Build, migrate, provision** - the existing one-shot `migrate` and `provision-context` services,
   each required to exit 0.
8. **Recreate** - workers and API first, wait for readiness, then web last.
9. **Verify** - `/`, `/control/` and `/ready` all HTTP 200; unbalanced journal entries (per entry
   **per currency**) and invalid database indexes must both be 0; recent logs scanned for errors.
10. **Report** - release id, promoted commit, rollback boundary, backup path, migrations promoted
    and preserved, endpoints and invariants. Only the Docker build cache is pruned; backups are
    kept.

### Why applied migration bytes are preserved

On 2026-09-04 twelve tenant migrations (`202609021800`-`202609021811`) were applied from a CRLF
checkout, so `_orvex_migrations` records CRLF checksums for them while the repository is now
LF-normalized. Production is self-consistent - the on-disk files are CRLF and match their recorded
checksums - but unpacking the LF versions over them would make the migrator abort with
`Applied migration ... has changed`, after services had already been stopped.

Applied migrations are immutable _including the bytes that were applied_. Phase 4 therefore keeps
the live file for any name already in the ledger and unpacks only new forward migrations. This is
generic, not a special case for those twelve: any future divergence is handled the same way.

Never edit a stored checksum in `_orvex_migrations` to make a mismatch disappear. If the preflight
fails, do not recreate services and do not rerun blindly - restore the historical migration bytes
from `<backup>/migrations.tar` and fix the artifact. See
[CI/CD and release](../../docs/operations/ci-cd-and-release.md) for the packaging controls that stop
new migrations from ever acquiring CRLF bytes.

### Scope

The host runs unrelated workloads. Keep all work inside `/opt/orvex-isp`, the `orvex-isp-prod`
Compose project, `/opt/orvex-backups`, and `/opt/orvex-releases`. The script does not delete files
that disappeared upstream, because this root also holds runtime output.

## Live verification

The `isp.mosesgr.com` production composition was verified on 2026-08-22 without changing host state:

- tenant workspace: HTTP 200
- Control Center: HTTP 200
- readiness: HTTP 200 with JSON response
- TLS: Let's Encrypt certificate for `isp.mosesgr.com`, valid through 2026-11-12

Do not redeploy merely to repeat these checks. Redeploy only after a reviewed source change, and
keep all host work scoped to this Compose project.
