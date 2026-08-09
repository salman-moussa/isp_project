# Security hardening checklist

Complete this checklist per environment and attach evidence. An unchecked item is not implicitly
accepted.

## Application and identity

- [ ] MFA and step-up policies are configured; recovery and break-glass access were exercised and
      audited.
- [ ] Cookie/token settings, CSRF, CORS, CSP, HSTS, framing, MIME, referrer and permissions headers
      pass tests.
- [ ] Rate limits and bounded request/upload/timeouts exist for auth, OTP, public verification,
      exports, sync and webhooks.
- [ ] Tenant/record/field authorization and support-access matrices pass negative tests.
- [ ] Debug routes, seed/demo credentials, source maps, verbose errors and test bypasses are
      disabled in production.
- [ ] Financial immutability, idempotency, currency separation and subscription/network separation
      gates pass.
- [ ] Upload quarantine, scan, signed download and CSV formula defenses pass abuse tests.

## Data, secrets and audit

- [ ] TLS and storage/backup/mobile encryption are enabled; key ownership and rotation are
      documented.
- [ ] Application fields store secret references, not secret values; logs/traces/jobs are
      redaction-tested.
- [ ] Database runtime roles cannot create roles, bypass tenant policy, or administer extensions.
- [ ] Redis authentication/ACL, persistence decision, eviction policy and private reachability are
      reviewed.
- [ ] Object policies prevent cross-tenant/list/admin access; public access is blocked.
- [ ] Privileged audit is append-only/tamper-evident and audit access/export is audited.
- [ ] Retention, legal hold, tenant export and deletion policies have authorized owners.

## Hosts, containers and network

- [ ] Only edge ports are public; data, monitoring, backup and management endpoints are private.
- [ ] Hosts use patched supported releases, automatic security updates, time sync, firewall, SSH
      key-only access and restricted sudo.
- [ ] Workloads run non-root, drop capabilities, use read-only filesystems where compatible, and
      have resource/probe/log limits.
- [ ] Images and actions are pinned to reviewed versions/digests or governed by an approved update
      process.
- [ ] Egress is restricted for network/provider workers; metadata and private address SSRF paths are
      blocked.
- [ ] Admin access uses MFA plus VPN/identity-aware access and produces audit events.

## Delivery and recovery

- [ ] Branch/environment protections require reviews, passing gates, signed/verified provenance
      policy and manual production approval.
- [ ] CI uses least-privilege permissions and short-lived cloud identity; forked/untrusted code
      cannot read deployment secrets.
- [ ] Secret, SAST, dependency, IaC, container, license-policy and SBOM gates meet release policy.
- [ ] Pre-deploy backup, migration compatibility, readiness/smoke, feature flags and rollback
      decision points are recorded.
- [ ] Encrypted off-host backup health is current and isolated restore exercises meet accepted
      RPO/RTO.
- [ ] Security contacts, incident roles, evidence preservation and credential rotation runbooks were
      rehearsed.
