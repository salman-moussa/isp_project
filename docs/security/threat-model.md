# Threat model

Status: Phase 1 baseline; review at every architecture or trust-boundary change. This is a design
artifact, not evidence of penetration testing or certification.

## Scope and security objectives

The platform includes a vendor control plane, isolated ISP tenant data planes, two staff web
applications, a collector mobile application, a core API, asynchronous workers, a MikroTik
connector, object storage, provider webhooks, and a single-document public verifier. The primary
objectives are:

1. Prevent one tenant, vendor user, support agent, job, cache key, object key, realtime channel,
   export, or backup from accessing another tenant's data.
2. Preserve financial integrity: USD and LBP remain separate; posted records are immutable;
   corrections are linked; writes are transactional and idempotent.
3. Ensure a platform subscription restriction never changes subscriber Internet-service state or
   enqueues network suspension.
4. Limit vendor support access to approved, scoped, visible, revocable, short-lived sessions with
   complete audit.
5. Protect MikroTik, provider, deployment, signing, and backup credentials and make uncertain
   network outcomes reconcile before retry.
6. Preserve offline collection without duplicate payments, lost receipts, or unauthorized access
   after device revocation.

The verification baseline is OWASP ASVS 5.0 Level 2 for web/API, with selected Level 3 controls for
administrative/support, payment, export, secret, and network-automation functions; OWASP API
Security Top 10; and applicable OWASP MASVS storage, authentication, network, platform, code,
resilience, and privacy principles. Exceptions require a recorded owner, rationale, compensating
control, expiry, and approval. No compliance or certification is claimed.

## Data and actors

High-value data includes subscriber PII, authentication material, payment and invoice records,
collector cash records, audit events, router credentials and desired state, provider webhook
secrets, deployment credentials, encryption keys, tenant exports, and backups. Actors include
platform and tenant staff, collectors and their devices, support agents/approvers, service
identities, providers, hosting operators, and attackers with anonymous, authenticated,
compromised-device, insider, or supply-chain access.

## Trust boundaries and required controls

| Boundary                          | Untrusted input                                | Required controls                                                                                                                                                          | Required evidence                                  |
| --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Internet to edge/API              | HTTP, document tokens, auth, uploads, webhooks | TLS, strict routing/CORS/CSP, size/time limits, schema validation, rate limits, WAF rules, secure cookies/CSRF, signature/replay checks                                    | Headers tests, DAST, rate-limit and webhook suites |
| Identity to application           | Session/token/device/context                   | MFA and step-up, rotation/reuse detection, revocation, verified tenant context, deny-by-default permission catalogue                                                       | Authorization matrix and session-abuse tests       |
| Control plane to tenant           | Support request/token                          | Approved ticket/reason/scope/duration, non-self approval, nonce, visible banner, per-operation audit, revocation and expiry; no general impersonation                      | Support-access E2E and negative tests              |
| API to tenant database            | Queries and transactions                       | Database-per-tenant or proven RLS, server-resolved connection, object authorization, parameterization, transaction/idempotency constraints                                 | Cross-tenant database and concurrency tests        |
| Process to Redis/queues/realtime  | Keys, payloads, channels, locks                | Verified tenant prefix, encrypted/authenticated private network, consumer re-authorization, idempotent inbox/outbox, DLQ authorization                                     | Key/channel/job isolation tests                    |
| Application to object storage     | Uploads, object keys, signed links             | Per-tenant prefix/bucket policy, MIME/content validation, malware quarantine, short-lived URLs, encryption, audit                                                          | Upload-abuse and cross-prefix tests                |
| Mobile device to sync API         | Offline operations, refresh tokens             | Secure key store and encrypted DB, device binding, rotated tokens, revocation on every sync, client operation IDs, server idempotency, conflict records                    | Offline replay, revoked-device and conflict tests  |
| Core API to network worker/router | Desired state and credentials                  | Separate service identity, vault references, command allowlist, preview/approval, durable jobs, bounded retries, reconciliation of uncertain results, egress allowlist     | Simulator failure matrix and secret-leak checks    |
| Provider to webhook               | Signed events                                  | Raw-body verification, timestamp tolerance, nonce/event dedupe, unknown-event quarantine, tenant resolved from trusted configuration                                       | Forgery, replay, ordering and duplication tests    |
| CI/CD to runtime                  | Source, dependencies, images, credentials      | Protected environments, least privilege, short-lived federation, pinned/controlled actions and bases, SBOM, scans, provenance/signing when configured, immutable promotion | Workflow logs and artifact attestations            |
| Backup operator to recovery       | Encrypted snapshots and restore credentials    | Separate backup identity, off-host copy, immutable retention, isolated restore, dual approval, audit                                                                       | Timestamped restore-exercise record                |

## Abuse cases (STRIDE-oriented)

| ID    | Threat / abuse case                                                    | Impact                                   | Prevent / detect / respond                                                                                                                  |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TM-01 | Change a tenant identifier in URL/body/header to read another tenant   | Critical confidentiality breach          | Ignore client-selected tenant unless authorized context switching; object policies and database isolation; alert on mismatch                |
| TM-02 | Worker/job loses tenant context or reuses cache/object keys            | Cross-tenant disclosure or mutation      | Mandatory tenant envelope, typed keys, consumer assertion, database constraint, isolation tests across all async boundaries                 |
| TM-03 | Support agent browses tenant PII without approval                      | Privacy breach, insider fraud            | Approval gateway, minimum scopes, expiring non-refreshable token, banner, immutable reads/writes audit, anomaly alert                       |
| TM-04 | Platform overdue/restriction event triggers mass subscriber suspension | Wide service outage                      | Separate bounded contexts and event types; explicit prohibition in network worker; contract and negative tests; bulk-action circuit breaker |
| TM-05 | Replayed API/mobile operation posts duplicate payment or receipt       | Financial loss and reconciliation errors | Tenant-scoped idempotency key + request hash, unique constraints, atomic response replay, conflict on changed payload                       |
| TM-06 | Concurrent allocation overspends payment/credit                        | Ledger corruption                        | Serializable/locking transaction as designed, numeric constraints, invariant/property tests, immutable audit                                |
| TM-07 | Staff edits/deletes a posted record                                    | Evidence destruction                     | Append-only posted state, linked reversal/credit/debit notes, database constraints, dual approval for high-risk reversals                   |
| TM-08 | Collector device is stolen and syncs after revocation                  | PII/payment exposure                     | Encrypted local DB, OS key store, short token lifetime, device status checked per sync, remote revocation and local expiry                  |
| TM-09 | Malicious upload executes, exfiltrates, or bombs scanner               | Compromise/DoS                           | Type/size allowlist, signature sniffing, quarantine, sandbox scanner, decompression ratios, randomized keys, safe download headers          |
| TM-10 | Formula payload in CSV export executes in office software              | Credential/data theft                    | Prefix dangerous cells, explicit content type, tests for `=`, `+`, `-`, `@`, tab/CR, user warning                                           |
| TM-11 | Public document token is guessed, leaked, or enumerated                | Subscriber/document disclosure           | 128+ bits entropy, one-document scope, minimal fields, expiry/revocation, no index, throttling and access audit                             |
| TM-12 | Forged/replayed webhook records payment                                | Fraud                                    | Provider-specific signatures, raw bytes, timestamp/nonce, idempotency, manual verification state, quarantined unknowns                      |
| TM-13 | SSRF reaches cloud metadata, Redis, router, or scanner                 | Secret theft / lateral movement          | URL allowlists, deny private/link-local ranges after DNS resolution, controlled egress/proxy, no arbitrary fetch                            |
| TM-14 | MikroTik command injection or unsafe retry after timeout               | Subscriber outage                        | Typed commands/allowlist, no shell interpolation, desired-state job, uncertain status, reconcile-before-retry, bulk preview/approval        |
| TM-15 | Secret appears in log, trace, job payload, export, or image            | Credential compromise                    | Reference-only secrets, structured redaction, CI secret scan, canary tests, rotation runbook                                                |
| TM-16 | Compromised dependency/action/base image enters release                | Runtime compromise                       | Lockfile, restricted registries, dependency/SAST/container scans, SBOM, action SHA pinning before production, provenance review             |
| TM-17 | Operator restores wrong tenant or overwrites live data                 | Destructive data loss/isolation breach   | Restore to isolated target first, identity manifest checks, dual approval, reconciliation, cutover plan; never in-place by default          |
| TM-18 | Logs/metrics contain raw PII or high-cardinality tenant identifiers    | Privacy leak/observability outage        | Allowlisted fields, pseudonymous tenant correlation, sampling/cardinality budgets, log access audit                                         |

## Mandatory design review triggers

Re-review this model when tenancy topology, authentication/session format, support access, payment
posting, mobile storage/sync, upload pipeline, network command vocabulary, provider integration,
public verification, deployment topology, backup encryption, or CI trust changes. Security review
blocks release for unresolved critical/high findings; medium findings require an owner, due date,
compensating control, and explicit acceptance.
