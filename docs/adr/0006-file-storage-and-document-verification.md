# ADR-0006: File storage and public document verification

- Status: Proposed
- Date: 2026-08-09
- Deciders: Security, Architecture, Product, SRE
- Requirements: PRD-BND-002, PRD-TEN-003..004, PRD-SEC-003
- Risks: RSK-010, RSK-011, RSK-018

## Context

The platform handles identity documents, contracts, installation photos, payment proofs, PDFs and
exports. These have different sensitivity/retention and create malware, content spoofing,
enumeration and cross-tenant risks. QR verification must never become a Subscriber portal.

## Decision

Use S3-compatible object storage with separate control/tenant namespaces and workload IAM/KMS
policies. Application databases store opaque object ID, owner, hash, declared/detected type, size,
scan/promotion status, retention/legal-hold and safe metadata—not permanent URLs.

Uploads use short-lived server-minted quarantine targets. Completion verifies authenticated
owner/scope, actual size/hash, extension and detected MIME allowlist, decompression/work budget,
malware scan and image metadata policy. Only promoted objects can be downloaded; every download
reauthorizes record/field access and uses a short-lived signed URL. Scanner unavailable means
quarantine, not fail-open.

PDF/exports are async immutable artifacts with checksums, expiry and access audit. Spreadsheet
values beginning with formula-control characters are neutralized. Backups include object
manifests/versions and restore consistency checks.

Public verification stores only a hash of a cryptographically random token mapped to one document
and minimum disclosure projection, with issued/expiry/revoked times and access policy. The route has
generic errors, abuse limits, no listing/search/navigation/login and no raw private attachment.
Token rotation/revoke does not alter the posted document.

## Consequences

### 2026-09-02 bounded invoice implementation

Posted legal-snapshot invoices now have a private retained archive. The first implementation
reserves durable pending metadata, generates in the authorized request, and supports manual recovery
by invoice identity; a background bulk worker remains future work. Downloads stream through the API
after scope, checksum and audit checks instead of issuing a signed URL. This trades API bandwidth
for strict per-download authorization and avoids bearer URLs. User-upload scanning and the public
verifier remain separate unfinished surfaces. Activation and rollback details are in
[the invoice archive runbook](../operations/invoice-document-archive.md).

- Upload completion is asynchronous and requires clear scanning states.
- Signed URLs reduce API bandwidth but object IAM/prefix policies and short TTL are critical.
- File content and business metadata have coordinated lifecycle/restore manifests.
- Long-lived QR validity is a product/legal decision; revocation remains available.

## Rejected alternatives

- Files in relational DB: poor scaling/scanning/serving characteristics.
- Public bucket or stored signed URLs: unsafe expiry/scope behavior.
- Trust client MIME/extension: bypassable.
- QR containing document ID/account route: enumerable and portal-like.

## Validation

Cross-tenant/control object access, mismatched MIME/polyglot/oversize/decompression/malware, scanner
outage, expired signed URL, metadata policy, export formula injection, token
entropy/expiry/revoke/guess/rate/minimum-disclosure and object restore-manifest tests.
