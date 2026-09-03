# Serialized inventory custody checkpoint — 2026-09-04

This checkpoint is local engineering evidence for the warehouse custody slice. It is not a
production deployment record and does not claim that procurement, receiving, stock valuation, or
physical field acceptance is complete.

## Delivered vertical

- A dedicated responsive English/Arabic Warehouse & Custody workspace reads the signed tenant scope.
- Serialized assets can move through `in_stock/returned -> issued -> installed -> returned -> rma`.
- Issue binds the device to active field work and its assigned tenant technician.
- Return requires an active warehouse in scope and clears service, installation, and custodian
  links.
- Every transition requires an expected version, bilingual reason, verification evidence, and an
  idempotency key.
- Custody events are append-only and the allowed audit envelope is written atomically in the same
  PostgreSQL transaction.
- Support-grant sessions and unrelated permissions cannot use this workflow.

## Evidence run

The migration chain, including `202609021810_tenant_inventory_custody.sql`, was applied from zero to
a fresh local PostgreSQL 18.4 database. The restricted `orvex_runtime` role then proved:

1. branch/service-scoped workspace reads and a cross-branch empty result;
2. issue, install, return, and RMA transitions;
3. exact replay returning the original result;
4. conflicting retry and stale-version rejection;
5. four immutable custody history events; and
6. four matching atomic Operations audit-outbox records.

The executable proof is `packages/database/scripts/test-live-inventory.ts` and is included in the
database integration command after the sales fixture boundary.

## Remaining acceptance boundary

Production still needs a backup, forward migration, authenticated smoke test, and explicit rollback
decision. Procurement administration, PO lines and approvals, receiving, bins/transfers,
reservations/reorder policy, accounting valuation, and physical device reconciliation remain open.
