# ADR-0004: Money, ledgers, posting and corrections

- Status: Proposed — requires finance/legal approval
- Date: 2026-08-09
- Deciders: Finance Domain Owner, Product Owner, Architecture, Legal adviser
- Requirements: PRD-FIN-001..010, PRD-CTL-009..010, PRD-NFR-003
- Risks: RSK-002, RSK-008, RSK-009

## Context

Lebanese ISP workflows record USD and LBP, partial/advance/deposit/credit payments, optional VAT,
provider references and collector reconciliation. Retrying or editing posted finance can create
material loss/fraud. Exchange-rate and VAT law/policy cannot be inferred.

## Decision

Represent posted money as an immutable `(integer amountMinor, ISO currency)` value. Currency
scale/rounding comes from versioned configuration snapshotted on the posted document.
Application/API contracts accept only JavaScript safe integers within an explicit business limit;
PostgreSQL uses signed `bigint` plus currency constraints. No fractional binary floating-point
arithmetic is permitted. Proration, tax and exchange use arbitrary-precision decimal/rational
operands and an effective rounding rule, then produce checked minor units. Each document has one
ledger currency unless modeled multi-currency lines produce separately balanced currency sections.
Never sum/net USD and LBP. Conversion is a separate authorized effective-dated record containing
rational/decimal rate, source, approver, rounding, original and converted values.

Drafts are editable. Posting is a transaction that reserves idempotency, validates
policy/version/balances, assigns a scoped number, stores price/discount/tax/customer snapshots,
writes immutable ledger/document rows plus audit/outbox, and returns canonical identity. Posted
records have no update/delete domain command. Corrections use linked reversal/credit/debit/refund
records; PDF/report chains show the original and all adjustments.

Payments and allocations post atomically under lock/version checks. Allocation currency must match
and cannot exceed valid payment/invoice availability. Overpayment becomes explicit credit. VAT is
off by default and effective/versioned. Rounding occurs at documented calculation stages with stored
rule; final legal policy awaits DEC-001. Financial side effects such as PDF, sharing or network
restore are async and do not roll back posting.

## Consequences

- Accurate audit/correction history and concurrency safety at the cost of more explicit workflows.
- Integer minor units make addition/allocation exact and align with the existing contract, but all
  arithmetic must enforce safe/database range and currency scale. Rates/proration use arbitrary
  precision before explicit rounding.
- Derived balances need invariant queries/rebuildable projections.
- Sequence gaps may exist after committed correction or operational failure according to approved
  fiscal policy; numbers are never reused silently.

## Rejected alternatives

- Fractional floating-point amounts: unsafe for currency arithmetic.
- A universal two-decimal “cents” scale: rejected because currency/payment precision is configured
  and LBP/USD differ; the stored scale is explicit/versioned.
- PostgreSQL `numeric` amount values: exact and viable, but rejected for posted amounts in favor of
  simpler integer ledger invariants; retained for intermediate rate/policy fields where rational
  integers are not used.
- One LBP-equivalent base ledger: violates explicit separation.
- Mutating/deleting posted records: violates audit/fraud requirements.
- Ambient “current rate”: not reproducible or authorized.

## Validation

Table/property tests for rounding/tax/proration/allocation/conversion/currency separation;
concurrent duplicate/offline/API payment tests; immutable DB/API tests; correction-chain E2E; EN/AR
PDF content checks; reconciliation totals; finance/legal sign-off on
VAT/numbering/retention/rounding before production.
