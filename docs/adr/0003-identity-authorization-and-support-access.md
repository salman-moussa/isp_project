# ADR-0003: Identity, authorization, approvals and support access

- Status: Proposed
- Date: 2026-08-09
- Deciders: Security, Architecture, Product
- Requirements: PRD-IAM-001..010, PRD-BND-005, PRD-SEC-004..006
- Risks: RSK-001, RSK-004

## Context

The system has separate platform/tenant audiences, multi-scope staff, mobile devices, high-risk
financial/network/deployment actions and rare vendor support access. Role-name checks and long-lived
impersonation are incompatible with least privilege and auditability.

## Decision

Centralize identity security primitives while keeping platform and tenant session
audiences/memberships distinct. Web uses opaque server-side sessions in Secure/HttpOnly/SameSite
cookies with CSRF protection. Mobile uses short-lived access tokens and one-time rotated refresh
tokens bound to authorized device/session, with reuse detection and remote revocation. Passwords use
benchmarked Argon2id; privileged platform MFA is mandatory, tenant privileged MFA configurable.
Recovery is one-time, short-lived, rate-limited and audited.

Authorization is a deny-by-default policy engine using permission catalogue entries
(`resource.action`) plus tenant/branch/area/route/module/record/field scope.
APIs/services/jobs/files/exports/realtime and database capabilities enforce policy; UI gates are
explanatory only. High-risk policy obligations include recent step-up, reason, impact preview and
optional dual approval. The requester cannot approve their own request.

Support access is not ordinary impersonation. A ticket-linked request receives distinct approval;
the gateway issues a short-lived non-refreshable capability with tenant, ticket, reason,
permissions, approver, expiry and revocable nonce. Tenant banner/visibility is mandatory. Every
read/write is separately authorized and support-audited. Extension creates a new approval.

## Consequences

- Consistent policies and explicit obligations improve reviewability but require a maintained
  action/scope catalogue and matrix tests.
- Immediate revocation requires central session/nonce checks or short bounded caches with event
  invalidation.
- Support investigations may be less convenient; this is an intentional privacy control.
- Field-level serialization/export policy must be shared across interfaces.

## Rejected alternatives

- JWT-only long-lived stateless sessions: revocation/reuse/support constraints are too weak.
- Role checks in controllers/components: inconsistent and cannot model scope/approval obligations.
- Hidden platform impersonation: prohibited by product boundary.
- Same session audience for platform and tenant: raises confused-deputy risk.

## Validation

Authorization matrix/property tests, object/field IDOR tests, CSRF/session/token reuse tests,
step-up expiry and self-approval rejection, revoked-device propagation, support
no-session/over-scope/expiry/revoke tests, tenant banner E2E and immutable audit completeness
review.
