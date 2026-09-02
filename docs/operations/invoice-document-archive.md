# Invoice PDF and private archive operations

Requirements: PRD-FIN-004, PRD-LOC-004, PRD-TEN-003/004. Implemented slice: posted invoices with
immutable legal snapshots, owner-confirmed tax treatment, deterministic bilingual PDFs and retained
private objects. This is not certification of Lebanese tax compliance or a complete document
platform.

## Operator workflow

1. Publish a legal billing policy from the sales order billing prerequisite. Choose taxable, exempt,
   or outside VAT scope. Exempt/out-of-scope requires zero VAT, English/Arabic reasons and the
   approved authority reference. The owner and accountant supply these facts; Orvex invents none.
2. Post the first service invoice through the existing authorized workflow. Its supplier, recipient,
   service, tax and amounts are snapshotted. Later policy changes never alter that invoice.
3. Open Billing > Private invoice archive. Select a posted invoice and Generate / recover PDF. The
   workspace lists the latest 250 eligible invoices and archive entries. Recurring drafts without
   posted legal snapshots are deliberately not eligible.
4. Download PDF. The API rechecks session, invoice permission and branch/area/route/record scope,
   checks the private namespace, byte count and SHA-256, and persists access audit before returning
   the attachment. No public URL, customer login or verifier token is created.

## Storage activation (not performed on the production host)

Provision a **new dedicated private S3-compatible bucket**, with Object Lock enabled, versioning,
public access blocked, encryption at rest (use the operator's KMS policy where available), protected
backup/replication, and no lifecycle rule deleting retained objects. Never reuse a public upload
bucket. The writer uses conditional create-only PUT plus COMPLIANCE retention through the immutable
policy date. Historic dates already elapsed receive a minimum one-day object hold. API readiness
checks Object Lock when configured; private access policy, encryption and restore are deployment
acceptance checks, not inferred from that check. See
[AWS Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

Supply `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_ENDPOINT` (HTTPS), and optionally
`DOCUMENT_S3_FORCE_PATH_STYLE=true` for compatible providers. Credentials use the standard workload
credential chain; they are not stored in application tables or request payloads.

The optional `deploy/production/docker-compose.documents.yml` overlay mounts an operator-managed
AWS-format credential file, referenced by `DOCUMENT_S3_CREDENTIALS_FILE`, as a read-only secret. Its
default profile needs `s3:GetObject`, `s3:PutObject`, `s3:PutObjectRetention` on
`tenants/*/invoices/*`, and `s3:GetBucketObjectLockConfiguration` on the dedicated bucket, plus
required KMS permissions. Do not grant delete, bucket-policy changes, public ACL changes, or
retention bypass. IAM must also require conditional create-only writes: Object Lock protects
versions, not against a privileged actor placing a newer version at the same key. These credentials
must be readable by the API container's non-root user only as necessary.

Without configuration, the archive displays an explicit activation message and generation/download
returns unavailable. Other existing workflows continue. No fake PDF or fallback filesystem storage.
No production credentials were used to validate this slice. Before activating, verify real-provider
conditional PUT behavior, retention, encrypted restore and retrieval, and perform independent
review.

## Recovery, compatibility and rollback

- Apply tenant migrations `202609021100_tenant_invoice_documents.sql` and
  `202609021101_tenant_invoice_document_actor.sql` before deploying API/web. They are additive;
  existing policies receive `taxable`. New API policy writes require explicit `taxTreatment`.
- Metadata commits pending before rendering/storage. A storage/process failure leaves it retryable.
  Retrying the invoice uses the same artifact ID/key/version. An existing identical object is
  accepted; different bytes are never overwritten. The ready transition and its audit are atomic.
- This bounded first version performs generation in the request, not a scheduled background worker.
  Manual retry recovers interruption. Bulk generation, automatic durable scheduling and pagination
  beyond the workspace window remain future work; do not treat them as delivered.
- Renderer code, font assets and dependency versions are pinned. Bump the renderer version whenever
  bytes may change; never overwrite old artifacts. Font provenance: Google Fonts Noto Sans Arabic,
  SIL Open Font License in `apps/api/assets/fonts/OFL.txt`. Font bytes are committed, not fetched at
  runtime.
- Keep both DB metadata and object versions in coordinated backups. Restore and compare each ready
  row's namespace, hash and length before serving. Treat missing/mismatched objects as an incident;
  they fail closed and must not be silently regenerated against changed policy.
- App rollback may retain additive schema and immutable objects. Never roll back by deleting posted
  records, archive rows or retained objects. Keep the new archive UI unavailable if rolling back
  API.
- Upload quarantine/scanning, contracts, receipts, public single-document verification, legal holds,
  retention-disposal approval, PDF accessibility tagging and general export generation are outside
  this slice. Generated PDFs accept no user-provided binary, URL, script or attachment.

## Focused proof

`apps/api/src/documents/*.test.ts` covers determinism, financial validation, failure recovery,
namespace/checksum rejection, conditional PUT and Object Lock configuration. Operations route tests
cover authority and audit-before-download; UI tests cover the billing workspace and archive states.
`packages/database/scripts/test-live-sales.ts` covers actual PostgreSQL reserve/replay/finalize,
scoped denial, immutable deletion rejection and atomic document audit. The sample render command is
`npm exec --workspace=@isp/api -- tsx scripts/render-invoice-proof.ts`; it produces synthetic data
only.
