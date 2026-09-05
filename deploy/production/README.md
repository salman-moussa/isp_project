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

Use `deploy-checkpoint.sh` rather than an ad-hoc `up -d --build`. It promotes exactly one reviewed,
pushed commit and keeps every step before migration non-mutating, so an aborted deployment leaves
the previous release serving traffic:

```sh
ORVEX_DEPLOY_ACK=production-checkpoint-authorized \
  /opt/orvex-isp/deploy/production/deploy-checkpoint.sh <full-40-char-commit-sha>
```

Phases, in order:

0. **Authorization** — explicit acknowledgement, a full commit SHA (never a branch), and confirmed
   `/opt/orvex-isp/.env`, which is preserved and never regenerated.
1. **Read-only preflight** — free disk space, current `/ready`, current container state, and a valid
   Compose model for project `orvex-isp-prod`.
2. **Fetch** — confirms the target commit exists on `origin` and differs from the deployed commit.
3. **Backup** — source archive, `.env`, historical migration bytes, `pg_dump -Fc` of both databases,
   and both migration ledgers into a new `/opt/orvex-backups/<UTC>-<sha7>` directory, verified with
   `sha256sum -c`.
4. **Checkout and preflight** — verifies LF-only migrations and executable shell scripts, builds the
   images, then runs the **migration checksum preflight against the live database while the previous
   release is still running**. A checksum mismatch aborts here, at zero downtime.
5. **Migrate and provision** — the existing one-shot `migrate` and `provision-context` services,
   each required to exit 0.
6. **Recreate** — workers and API first, wait for readiness, then web last.
7. **Verify** — `/`, `/control/` and `/ready` all HTTP 200; unbalanced journal entries (per entry
   **per currency**) and invalid database indexes must both be 0; recent logs scanned for errors.
8. **Report** — release id, promoted commit, rollback boundary, backup path, applied migration,
   endpoints and invariants. Only the Docker build cache is pruned; backups are retained.

If the migration preflight fails, do not recreate services and do not rerun blindly. Restore the
historical migration bytes from the backup, fix the release artifact, and never edit a stored
checksum in `_orvex_migrations`. See [CI/CD and release](../../docs/operations/ci-cd-and-release.md)
for the packaging controls that prevent the CRLF and lost-executable-bit failures this script guards
against.

The host runs unrelated workloads. Keep all work inside `/opt/orvex-isp`, the `orvex-isp-prod`
Compose project, and `/opt/orvex-backups`.

## Live verification

The `isp.mosesgr.com` production composition was verified on 2026-08-22 without changing host state:

- tenant workspace: HTTP 200
- Control Center: HTTP 200
- readiness: HTTP 200 with JSON response
- TLS: Let's Encrypt certificate for `isp.mosesgr.com`, valid through 2026-11-12

Do not redeploy merely to repeat these checks. Redeploy only after a reviewed source change, and
keep all host work scoped to this Compose project.
