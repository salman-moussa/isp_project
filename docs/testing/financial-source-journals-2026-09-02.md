# Financial sources and accounting workflows — 2026-09-02

Status: **partial, local evidence; production deployment held.**

## Implemented boundary

Requirements: REQ-FIN-001/002, REQ-COL-002 and REQ-SEC-003.

- New invoice, receipt, allocation and linked reversal records generate immutable, balanced journals
  in the same database transaction as their source and audit evidence. Governed invoices use their
  actual net/VAT/stamp snapshot. USD cents and whole LBP are never mixed.
- Existing customer-credit/deposit journals are reused, not posted twice. Replay uses the original
  source identity. Missing historical journals are not silently manufactured.
- Raw finance API writes now receive the server's signed Operations attestation. Source guards check
  tenant, actor, permission/action, scope and signed audit attribution. Unsigned writers are
  rejected. Approved support sessions are not authorized for these financial mutations.
- Financial requests take the accounting-period mutex before source row locks. Every new source
  checks its effective date against closed periods. Original records and historical migrations
  remain untouched.
- Bare invoices have no tax breakdown and office/raw receipts have no reliable payment-method field.
  They post to explicitly flagged clearing accounts, not guessed revenue, tax or cash. An authorized
  manual classification must offset the source clearing balances completely. Classification is
  immutable and audited; date-cutoff coverage and later source reversal include the correcting
  journal. Close remains blocked by unreconciled sources or historical coverage.
- Bilingual Accounting UI now provides balanced manual journals, clearing classification, explicit
  period-close acknowledgement, recent-MFA verification and paginated customer statements. Forms
  retain the idempotency key after a lost response and handle denial/retry/empty states.
- Collect sync binds the signed source session to the authorized device instead of joining the
  obsolete tenant session table. The API still validates live canonical auth-session revocation.
  Each receipt/allocation gets the correct finance audit action. Assignment payment locks use a
  narrow owner-mediated function; runtime gets no broad UPDATE or private guard-table grant. Collect
  assignment reads use the existing signed/scoped balance function.

## Focused evidence

Local PostgreSQL 18: restricted runtime role, synthetic SALES fixtures in localhost/isp_test only.
The fixture refuses remote database URLs. It creates synthetic append-only evidence and revokes its
short-lived signing key; it does not delete tenant records.

- Applied forward migrations 202609021803 through 202609021807.
- Governed sales-to-billing and archived-invoice live proof passed.
- Financial-source proof passed for net/tax/stamp, USD/LBP receipts/allocations/exact reversals,
  signed and unsigned boundaries, retries, atomic audits, classification, cutoff dates, all-writer
  closed-period denial and real Collect payment/allocation/source-session binding.
- 11 focused tenant UI tests passed: AccountingWorkspace and AccountingForms.
- 10 focused API tests passed: finance and Collect service.
- 6 focused database tests passed: accounting migrations and finance repository query safety.
- Customer-account live proof passed after selecting a fresh, open-period, journaled fixture:
  credits/deposits/reversals, concurrent retries, statements, scope/currency denials and audit.
- Changed-source ESLint, tenant-web typecheck and schema safety check passed.
- Contracts/database/API/tenant-web builds passed. Vite reports a 508.45 kB main JavaScript chunk
  (147.13 kB gzip); code splitting remains a performance improvement, not a failed build.

Commands (from repository root unless noted):

```text
node --conditions=development --import tsx packages/database/scripts/test-live-sales.ts
node --conditions=development --import tsx packages/database/scripts/test-live-financial-journals.ts
node --conditions=development --import tsx packages/database/scripts/test-live-customer-accounts.ts
# apps/tenant-web:
node ../../node_modules/vitest/vitest.mjs run src/billing/AccountingForms.test.tsx src/billing/AccountingWorkspace.test.tsx
# apps/api:
node ../../node_modules/vitest/vitest.mjs run src/collect-service.test.ts src/finance.test.ts
# packages/database:
node ../../node_modules/vitest/vitest.mjs run src/operations/accounting-migration.test.ts src/finance-repository.test.ts
```

The live scripts require the SALES_TEST_ADMIN_DATABASE_URL, SALES_TEST_RUNTIME_DATABASE_URL and (for
sales) SALES_TEST_NETWORK_WORKER_DATABASE_URL pointing at local isp_test. Run sales first to supply
a fresh governed invoice for Collect.

## Operator workflow

1. Open Accounting with tenant-wide accounting authority. A scoped statement also needs access to
   its customer; the UI customer directory currently requires subscriber-view permission.
2. Review coverage warnings and source records before classifying. Select a pending journal, enter
   the complete clearing offset and independently supported counterpart lines, and provide
   English/Arabic reasons. Verify identity, then explicitly post.
3. Customer statement shows net customer position including advances, not an AR-only general ledger.
   Select a single currency and optional dates; pagination preserves the same filters.
4. Close only after reviewing source coverage and the trial balance. Confirm the date window and
   bilingual reason. Both soft and hard close block further postings to their dates. No reopen
   workflow is supplied by this patch.

## Release, compatibility and rollback

Apply the complete migration series before this binary: signed Operations requests call the new
financial mutex helper. Do not use an older unsigned financial writer after migration. Never edit
applied migrations, drop guards or revert to the old duplicate auto-posting binary.

No production access, migration, deployment, backup/restore, visual browser acceptance, physical
printer test or independent review was performed in this checkpoint. Before promotion:

- Independent finance/security/mobile-sync review is mandatory under AGENTS.md.
- Inventory historical journals read-only; approve the exact reconciliation/opening-entry plan. This
  patch neither creates historical corrections nor authorizes them.
- Establish a verified backup/restore point and pause finance writes during the reviewed switch.
- Update remaining legacy unsigned integration fixtures to use the signed boundary before relying on
  the full integration/validate gate. This checkpoint does not claim the full suite passed.
- Check scale/lock contention: financial posting is serialized per tenant; cross-tenant work is
  independent. Do not weaken the lock to resolve capacity without reviewing close races.

Remaining software: onboarding/chart administration, complete journal pagination (list is latest
100), historical reconciliation, refunds/AP/treasury/reporting, warehouse/NOC workflows and real
RADIUS execution. Remaining acceptance: signed Android artifact, physical offline/printer testing,
provider/network activation and independent production review. The full capability map still
contains unfinished work; live health is not full-product acceptance.
