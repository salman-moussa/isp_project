# Procurement and serialized receiving acceptance — 2026-09-04

This checkpoint closes the governed path from supplier registration to valued serialized stock. It
does not claim non-serialized stock, partial receipts, supplier quote comparison, bins,
reservations, or inter-warehouse transfers.

## Accepted behavior

- Catalog authority registers bilingual suppliers and creates immutable purchase-order lines.
- Accounting-post authority with recent MFA approves a versioned draft through a separate API route.
- Catalog authority receives every outstanding serialized unit into the selected warehouse.
- Exact idempotency replays return the original result; conflicting retries and stale versions fail.
- Receipt posts one balanced journal: Inventory debit and Accounts Payable credit in the PO
  currency.
- The bilingual responsive tenant workspace exposes vendor, PO, approval, receipt, and custody
  history.
- Support grants are rejected at both API and database command boundaries.

## Evidence

- Fresh PostgreSQL 18.4 migration through `202609021811_tenant_procurement_receiving.sql` passed;
  the live proof ran after removing superuser privileges from the application owner role.
- Live database proof passed vendor → draft → approval → serialized receipt, replay/conflict,
  workspace readback, cross-branch denial, immutable evidence, and USD 150.00 balanced Inventory/AP
  posting.
- Database, API, and tenant-web unit suites, typechecks, lint, schema check, and production builds
  passed for the checkpoint.
