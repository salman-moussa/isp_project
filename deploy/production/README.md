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

Migrations and signing-key provisioning run as one-shot prerequisites. Authentication delivery is
deliberately fail-closed until an approved HTTPS OTP/recovery provider replaces the placeholder URL.
Bootstrap user credentials must be created through the DBA-controlled release procedure and must not
be committed.

## Live verification

The `isp.mosesgr.com` production composition was verified on 2026-08-22 without changing host state:

- tenant workspace: HTTP 200
- Control Center: HTTP 200
- readiness: HTTP 200 with JSON response
- TLS: Let's Encrypt certificate for `isp.mosesgr.com`, valid through 2026-11-12

Do not redeploy merely to repeat these checks. Redeploy only after a reviewed source change, and
keep all host work scoped to this Compose project.
