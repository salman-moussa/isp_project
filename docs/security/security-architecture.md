# Security architecture

Status: target architecture for Phase 1; implementation evidence is tracked by tests and release
records, not by this document.

## Control model

Security is deny-by-default and defense-in-depth. Authentication establishes an actor and
session/device. A trusted server-side resolver establishes platform or tenant context. A central
authorization service evaluates permission, record, field, scope, approval, and step-up
requirements. Domain services enforce invariants. Storage, queues, cache, files, realtime, exports,
logs, and backups preserve the verified tenant context independently.

### Identity and sessions

- Web: server-managed opaque session or short-lived token in `Secure`, `HttpOnly`, appropriately
  scoped `SameSite` cookies; CSRF token for state changes. Never store bearer tokens in browser
  local storage.
- Mobile: short-lived access token plus rotated refresh token bound to an authorized device; reuse
  detection revokes the token family. Secure OS key storage and encrypted local database are
  mandatory.
- Passwords: Argon2id parameters benchmarked per production class, breached-password screening,
  generic errors, throttled recovery with one-time short-lived tokens.
- Privilege: MFA mandatory for privileged platform roles and configurable/strongly recommended for
  privileged tenant roles. Step-up is required for support access, exports, credential rotation,
  bulk network action, restore, rollback, and configured high-value financial actions.
- Sessions: idle and absolute expiry, session/device listing, immediate revocation, risk events, and
  no silent extension of support sessions.

### Authorization and approvals

Application code checks permission catalogue entries, never role-name conditionals. Evaluation input
includes actor, tenant, branch/area/route/module/record/action scope, device/session assurance,
amount/risk threshold, support-session claims, and approval state. Dual approval rejects
self-approval. Each sensitive attempt records request ID, actor, tenant, IP/device, reason,
before/after summary, approver, result, and timestamp without secret or excessive PII fields.

### Tenant isolation

The preferred target is a separate control database and a database per tenant. The tenant connection
is selected only from trusted deployment metadata after actor authorization. If any shared schema is
introduced, PostgreSQL row-level security must be forced for the runtime role, migrations must
prohibit bypass roles, and automated negative tests must prove isolation.

Every boundary carries a validated tenant envelope. Queue payloads and events contain a stable
tenant identifier but consumers resolve and re-authorize it. Redis keys, locks, idempotency keys,
object keys, realtime topics, export paths, backup manifests, and telemetry correlation use scoped
namespaces. Platform analytics receives only explicitly approved aggregates, never raw subscriber
PII.

### Financial and network integrity

- Store money as exact numeric plus ISO currency; never convert implicitly or combine USD/LBP
  totals.
- Posted financial documents are append-only and corrected through linked documents. Idempotency
  uses `(tenant, operation, key)` uniqueness and binds the key to a canonical request hash.
- Subscription lifecycle and subscriber Internet-service lifecycle are separate modules and event
  vocabularies. A static dependency rule and runtime authorization prevent subscription events from
  creating network jobs.
- Network worker credentials are secret-manager references. Commands use typed adapters and
  allowlists. Jobs record desired state, attempt, timeout, known/uncertain result, reconciliation,
  and audit. Uncertain outcomes are not blindly retried.

### Data protection

TLS is required in transit. Production database volumes, object storage, mobile storage, and backups
require encryption at rest; highly sensitive fields should use envelope encryption with a KMS
reference. Secrets are injected at runtime and never returned by general APIs. Logs use an allowlist
and redact authorization, cookies, tokens, secrets, payment proofs, subscriber contact details, and
router configuration.

Uploads enter quarantine, are bounded by type/size/decompression ratio, validated by content
signature, malware-scanned, metadata-sanitized where appropriate, and promoted to a tenant-scoped
immutable key only after acceptance. Downloads use short-lived signed URLs, content disposition,
`nosniff`, authorization, and audit.

### Edge and infrastructure

Only reverse-proxy endpoints are public. Application, data, management, backup, and monitoring
networks are separate. PostgreSQL, Redis, object storage administration, metrics, and diagnostics
are private. Workloads run non-root with dropped capabilities, read-only root filesystems where
compatible, bounded resources, health probes, log rotation, and least-privilege identities.
Administrative access uses MFA/VPN or an identity-aware gateway and is separately audited.

Recommended browser/API headers include HSTS after HTTPS rollout, a nonce/hash-based CSP,
`frame-ancestors 'none'` unless a reviewed embedding use exists, `X-Content-Type-Options: nosniff`,
strict `Referrer-Policy`, a minimal `Permissions-Policy`, and an explicit CORS allowlist. Public
verification and authentication receive risk-specific rate limits.

## Security ownership and evidence

| Control                                      | Primary owner                         | Evidence                                     |
| -------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| Identity, authorization, tenant context      | Application teams                     | Unit/API/integration/E2E matrices            |
| Database isolation and financial constraints | Data/backend                          | Migration inspection and database tests      |
| Mobile local protection and sync             | Mobile                                | Device, offline, replay and revocation tests |
| Network command safety                       | Network/integrations                  | Simulator failure matrix and audit traces    |
| Edge, secrets, workloads, backups            | DevOps/SRE                            | IaC review, scan output, restore exercises   |
| Threat model, release findings               | Security                              | Review record and risk register              |
| Approval and business acceptance             | Product owner / authorized risk owner | Dated acceptance record                      |
