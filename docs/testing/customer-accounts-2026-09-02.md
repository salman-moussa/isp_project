# Customer account checkpoint — 2026-09-02

Scope: REQ-FIN-001/002, REQ-SEC-003; unpaid-invoice credits, deposits and linked balance
corrections. No production server, real financial record or external provider was changed. Generated
apps/collect/android files remain untouched.

## Captured evidence

- 52 focused tests passed: API Operations routes (23), service adapter (2), readiness (5), shared
  customer-account schemas (9), customer-account UI (3), Billing workspace (1), exact money parsing
  (9).
- The component proof covers lost-response retry with an unchanged idempotency key, exact USD 0.29 →
  29 minor units, success reset, denied reads, Arabic labels, RTL and automated accessibility
  checks. Automated accessibility excludes color-contrast; no manual browser/device acceptance is
  claimed.
- Database, API and tenant-web production builds passed.
- The test PostgreSQL migration plan applied 1200/1201. Initial unapplied SQL parsing was corrected;
  after 1200 applied, denied raw guard reads were fixed using forward-only 1201, not a broad grant.
- The command node --conditions=development --import tsx
  packages/database/scripts/test-live-customer-accounts.ts passed against local disposable
  PostgreSQL 18, using a synthetic sales fixture. It checks credits, separate receipt vs allocation
  effects, exact reversals, repeated/concurrent idempotency, payload conflict, permission/empty
  branch/empty record scope denials, invalid subscriber/invoice, cross-currency denial,
  over-credit/tax ceilings, credited invoice allocation ceiling, concurrent deposit spending,
  duplicate receipt reference, used/reversed receipt rejection, append-only access, updated
  subscriber balances, dunning read and exactly 12 successful account audit entries. Successful test
  corrections restore the invoice's starting balance; synthetic history remains.
- Focused ESLint passed after correcting type-import and explicit-string handling findings.
  Database schema safety passed. The staged Git whitespace check found one harmless trailing blank
  line in applied migration 1201; it is retained to preserve the applied checksum. No other whitespace
  error was reported.

## Reproduction

Apply tenant migrations to the disposable test database. The account proof intentionally refuses
non-local targets or any database name other than isp_test. It uses the synthetic unpaid sales
fixture from packages/database/scripts/test-live-sales.ts, not production customer data. Set
SALES_TEST_ADMIN_DATABASE_URL and SALES_TEST_RUNTIME_DATABASE_URL to the test-only connections.

Focused unit commands, from the respective workspaces:

- API: vitest run src/operations-api.test.ts src/operations-service.test.ts src/readiness.test.ts
- Contracts: vitest run src/customer-accounts.test.ts
- Tenant web: vitest run src/billing/CustomerAccounts.test.tsx src/billing/BillingWorkspace.test.tsx
  src/billing/account-money.test.ts

No aggregate whole-repository suite, performance/soak, production migration, backup restore,
collector hardware test or independent review was performed for this checkpoint.

## Release limits

Independent finance/tenant-isolation review is pending, as required by AGENTS.md. The bounded
activity view is not a full statement, and internal credits are not legal credit-note PDFs.
Paid-credit carry-forward/refunds, debit notes, accounting close and production provider/storage
acceptance remain open. See the [runbook](../operations/customer-accounts.md) for rollback
restrictions: old code that ignores credited balances is unsafe after credits have been posted.
