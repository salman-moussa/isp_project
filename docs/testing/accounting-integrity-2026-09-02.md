# Accounting integrity checkpoint — 2026-09-02

Status: **partial; local verification only; not approved for production.**

## Delivered in this step

- Removed the application's request-derived journal append. The database now journals the actual
  customer-account record in the same transaction. Credits separate net/VAT/stamp; deposits use an
  advance liability; applications move the liability to AR; linked reversals swap original lines,
  including LBP amounts. Replays create neither a second journal nor a second audit record.
- Added tenant-composite foreign keys, safe one-sided amounts, deferred per-currency balance
  enforcement, append-only journals/periods, runtime write revocation, signed/scoped manual posting,
  atomic audit, payload-sensitive idempotency and journal-period locking.
- Statement reads now use real invoice/allocation/customer ledgers, including reversals. The net
  customer position counts deposits once. SQL performs UTC date filtering, opening/running/closing
  balances and stable pagination. USD and LBP are separate; numeric overflow is rejected.
- Trial balances exclude future and non-posted journals. Reads no longer seed accounts. Global
  accounting lists require tenant-wide scope; customer statements retain subscriber/service scope.
- Registered periods and statement GET routes, corrected array serialization, forwarded validated
  date queries, and added recent-MFA manual-journal/period-close API endpoints.
- Removed sample financial balances, journal records and periods from the UI. Added actual loading,
  empty, error/retry, sign-in and incomplete-coverage states; stale-tenant responses are discarded.
  Amounts format USD cents and whole LBP correctly in English and Arabic.

## API contracts

GET base: /v1/tenants/:tenantId/accounting

- /chart-of-accounts, /journal-entries (latest 100), /periods return arrays.
- /trial-balance accepts asOfDate (ISO calendar date). Coverage flags identify legacy journals and
  unjournaled invoices/customer entries/receipts/allocations. Coverage is not a financial audit.
- /customer-statement accepts subscriberId, currency, startDate, endDate, page and pageSize.
  Statements express the net customer position, including advances, not an AR-only GL statement.
- POST /v1/tenants/:tenantId/operations/accounting/journals accepts {command: ...}, manual source
  only; tenant.accounting.post, recent MFA and Idempotency-Key are required.
- POST /v1/tenants/:tenantId/operations/accounting/periods/close accepts {request: ...};
  tenant.accounting.close, recent MFA and Idempotency-Key are required. Existing incomplete
  invoice/customer/payment coverage or legacy journals blocks close.

## Captured focused evidence

Executed against local PostgreSQL 18, database isp_test, using the restricted orvex_runtime role:

- Tenant migrations through 202609021802 applied successfully.
- test-live-customer-accounts.ts passed: existing credits/deposits/reversals/concurrency/scopes,
  exact automatic journals, LBP reversal, tax components present on fixture, statement paging/date
  opening/deposit transfers, tenant denials, raw SQL imbalance/currency/foreign-account rejection,
  manual replay/conflict, trial date cutoff, journal closed-period denial and atomic audit.
- Focused tests: 27 API route tests, 5 accounting UI tests, 18 accounting/customer contract tests, 2
  accounting migration checks. These are not 52 full end-to-end workflows.
- Contracts/database/API/tenant-web typechecks and builds passed during this checkpoint.
- Schema safety check passed. Source ESLint is run separately from the executable live fixture: that
  script is outside the repository's ESLint TypeScript project configuration.
- No production migration, deployment, visual browser acceptance, hardware test, backup/restore
  exercise or independent review is claimed.

## Deployment hold and rollback limits

Migrations 202609021800, 202609021801 and 202609021802 are forward-only and already applied to the
local test database. Do not edit their contents or apply only part of this series. Their purpose is
journal integrity, owner-only forced-RLS access, line denials and close-coverage checks.

Before any production rollout, obtain independent finance/security review, inventory existing ledger
data read-only, approve the exact treatment of historical entries, establish a verified
backup/restore point, and pause financial writes during the migration/binary switch. This patch does
not supply or authorize historical corrective entries.

Legacy journals are preserved and marked legacy. Reversing a legacy customer entry or applying a
legacy deposit without a v2 journal is rejected. There is deliberately no automatic rewrite or
fabricated opening balance. An approved, audited reconciliation mechanism is still required. Never
switch back to d0c726f after these guards: that binary performs the removed duplicate,
request-derived journal insert. Use a reviewed forward fix; do not drop immutable guards to make an
old binary run.

## Subsequent checkpoint

The [financial-source checkpoint](financial-source-journals-2026-09-02.md) supersedes the invoice,
payment, close-coordination and forms gaps listed below. GitHub authentication and feature-branch
push are also resolved. This earlier evidence is retained as historical context.

## Remaining work / next owners (at this checkpoint)

1. **Finance implementation + independent reviewer:** automatic invoice, ordinary payment,
   allocation and reversal posting across all writers; legacy reconciliation/opening journals;
   closed-period coordination across those legacy financial writers; chart management/onboarding,
   manual journal/close/statement UI forms, full journal pagination, AR/AP/treasury and statutory
   reporting. The close implementation protects journal postings; this is not acceptance of all
   legacy billing writers against period close.
2. **Operations/network implementation:** wire warehouse and NOC mutations through scoped,
   idempotent, audited API/UI workflows; replace the RADIUS database-only "disconnect" with a real
   durable execution/acknowledgement boundary. A changed session row is not a disconnected NAS.
   These paths were not changed or accepted in this step.
3. **Mobile/operations acceptance:** reproducible signed Android artifact, actual device offline
   synchronization and Bluetooth printer acceptance, configured provider/network acceptance.
4. **Release owner:** resolve GitHub authentication if needed, verify remote commit identity,
   independent review and deployment evidence. Existing live health does not prove this patch is
   deployed or that the full enterprise platform is finished.
