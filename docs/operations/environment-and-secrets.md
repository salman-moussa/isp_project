# Environment, configuration and secrets reference

## Precedence and validation

Configuration is explicit per environment: checked-in safe defaults → environment-specific
non-secret configuration → runtime secret references/injection. The application must validate all
required values and allowed modes at startup, reject unknown production bypasses, and log
names/status only—not values. `.env.example` is a name/schema aid for local development; production
does not use committed `.env` files.

| Class                | Examples                                                       | Storage                                                       |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Public/non-secret    | URLs, locale, timezone, feature mode, limits                   | Versioned environment config/IaC                              |
| Sensitive reference  | `*_SECRET_REFERENCE`, KMS key ID, vault path                   | Versioned if identifier disclosure is acceptable              |
| Secret               | DB/Redis password, signing key, provider token, webhook secret | Secret manager/runtime injection only                         |
| High-risk credential | Deployment, backup, router, KMS admin                          | Separate least-privilege identity; short-lived where possible |

## Required namespaces

- Runtime: `APP_ENV`, public/control URLs, tenant base domain, log level/format, timezone and
  locales.
- Data: separate control and tenant-admin URLs, Redis URL, object endpoint/bucket/region and
  credentials/references.
- Security: session/encryption/signing/KMS references, cookie/CSRF/CORS settings, support-token
  issuer/audience, size/rate limits.
- Integrations: MikroTik connector mode/timeout, OMT/Whish/payment/maps/OTP/mail modes and secret
  references. Live modes default off until contract and security review.
- Observability: OTLP endpoint/protocol, service/version/environment, metric/log endpoints and
  sampling. Never put secrets or raw PII in resource attributes.
- Operations: release/environment identifiers, backup bucket/KMS/retention, deployment channel,
  maintenance and feature flags.

The canonical variable list and safe local examples are in `.env.example`. Service-specific schemas
should derive from a shared typed validator so misspellings fail rather than silently selecting
unsafe defaults.

## Secret lifecycle

1. An authorized owner requests a narrowly scoped secret; approval is recorded for privileged
   credentials.
2. Generate inside the target secret system. Never transmit through chat, issue text, source
   control, image build args or CI logs.
3. Grant only the workload identity and emergency operators; separate staging/production and
   control/tenant/backup duties.
4. Inject at runtime, redact structured logs and test with a canary value.
5. Rotate periodically and immediately after suspected disclosure, staff/device loss, provider
   change or environment copy. Support overlapping versions where zero downtime is required.
6. Revoke old access, verify health and audit, then close the rotation record.

Rotation order normally covers signing/session keys with multi-key verification, database/Redis
users, object keys, provider/webhook secrets, router credentials, backup identities and CI/cloud
federation. Never rotate encryption keys without a tested rewrap/recovery plan.

## CI and preview environments

Pull requests from forks/untrusted code receive no deployment secrets. Prefer OIDC workload identity
with protected GitHub environments and audience/subject restrictions. Preview resources use
synthetic data, isolated namespaces, TTL cleanup and fake providers. Secret scanning findings
trigger containment and rotation; deleting a committed secret is insufficient.
