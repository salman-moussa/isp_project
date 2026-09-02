# Invoice archive checkpoint - 2026-09-02

Scope: PRD-FIN-004 / PRD-LOC-004 posted legal-snapshot invoice PDFs, explicit policy tax treatment,
private retained object adapter, scoped API download and bilingual archive UI. Not a whole-product
production sign-off; no production machine, provider account or real customer document was changed.

## Captured evidence

- **44 focused tests passed:** API operations routes (21), adapter (2), readiness (5), PDF renderer
  (3), object store (3), archive service (2), tax schema (1), bidi layout (2), Billing workspace
  (1), invoice archive UI (2), Sales workspace (2). The initial route run hit a 5-second test
  timeout while Docker was starting; rerun passed. No timeout was added to application behavior.
- Database, API and tenant web builds passed; TypeScript checks passed. Focused ESLint across all
  touched runtime/test modules passed after resolving findings. `git diff --check` passed.
- `npm run db:check --workspace=@isp/database` passed.
- Tenant migrations 1100/1101 applied on the disposable PostgreSQL 18 test service. The live sales
  proof passed lead-to-activated-and-billed flow plus archive pending/ready, exact replay,
  conflicting invoice/key and checksum rejection, empty branch scope denial, deletion rejection and
  exactly two mutation audit events. `invoice_document_readiness()` returned four true values.
- The first migration run exposed a UUID/text actor comparison in the audit trigger; forward-only
  migration 1101 corrected it. The applied migration was not rewritten.
- Production Compose plus the opt-in document overlay passed `config --quiet` with test
  placeholders. This validates configuration structure, not a live deployment or bucket policy.
- Synthetic two-page A4 PDF was rendered with bundled Poppler and both pages visually inspected.
  Arabic shaping, mixed `Block A-123` text, layout and exact USD 184.82 total were checked. Repeated
  generation produced identical bytes. The PDF skill drove visual review and mixed-script
  correction.

Commands used include targeted `vitest run`, `tsx scripts/render-invoice-proof.ts`, package builds,
focused `eslint`, schema checking, and `scripts/test-live-sales.ts` with test-only database URLs. No
full-suite, load, DAST, backup restore or independent review result is claimed.

## Release conditions and remaining work

Production bucket configuration, real S3-compatible conditional-write/Object Lock acceptance,
encryption/IAM/restore evidence and independent finance/tenant-isolation review remain required.
Private storage is visibly unavailable until configured. Bulk document workers, full archive
pagination, credit/deposit workflows, public verification, scanned uploads and whole-enterprise
acceptance remain outside this checkpoint. See the
[archive runbook](../operations/invoice-document-archive.md) and
[enterprise ledger](../enterprise-release-status.md).
