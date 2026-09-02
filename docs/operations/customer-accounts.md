# Customer account adjustments

Implemented checkpoint: REQ-FIN-001/002, REQ-SEC-003 and bilingual Operations requirements. This is
a bounded customer-ledger workflow, not a complete accounting system or statutory credit-note
document service.

## Operator workflow

Open **Billing → Customer ledger**, choose the customer, and select an operation:

| Operation                  | Effect                                                                         | Required permission    |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| Record deposit received    | Records an actual receipt in the payment ledger; no invoice settlement yet     | tenant.payment.post    |
| Apply deposit to invoice   | Allocates funds to the same customer's invoice, in the same currency           | tenant.payment.post    |
| Credit unpaid invoice      | Reduces unpaid charges; net, VAT and stamp cannot exceed the original snapshot | tenant.invoice.reverse |
| Reverse credit note        | Exactly undoes the selected credit; restores the receivable                    | tenant.invoice.reverse |
| Reverse deposit allocation | Exactly releases the selected allocation for reuse                             | tenant.payment.reverse |
| Correct unused receipt     | Reverses a mistaken unallocated receipt; does not send money                   | tenant.payment.reverse |

All mutations require recent MFA, a unique new document number, bilingual reasons and confirmation.
Reads require tenant.billing.view. Support sessions are denied. Tenant and branch/area/route/record
scopes come from signed session authority. Record-scoped account work requires access to both the
subscriber and any linked invoice service.

Amounts are entered in dollars (up to two decimals) or whole LBP. The server stores integer minor
units. No implicit exchange conversion, cross-customer spending or editable balance field exists.

For deposits, supply a unique real receipt/bank reference. A reference cannot be reused under a new
idempotency key. Confirm the money was actually received outside this screen: it performs no bank
transfer, card charge, provider refund or cash handover.

If the response is lost, retry the unchanged form: the screen keeps the same idempotency key until
success or a payload change. After reloading, use the original document/reference and inspect
activity first; uniqueness blocks a duplicate receipt. After success the document fields clear.

The screen is explicitly bounded to 500 authorized customers, the latest 500 invoices and the latest
500 account entries. It is not an exhaustive account statement; full pagination/export remains open.
The original invoice PDF remains unchanged. Credit tax components require accountant confirmation;
the software enforces ceilings, not legal eligibility for a particular tax adjustment.

## Technical contract

- GET /v1/tenants/:tenantId/operations/customer-accounts/workspace.
- POST the same prefix followed by /credit_note, /credit_reversal, /deposit_received,
  /deposit_applied, /deposit_application_reversal, or /deposit_reversal.
- POST requires the idempotency-key header. Schemas are in
  packages/contracts/src/customer-accounts.ts; clients cannot choose the authorization context.
- operations_customer_account_entries is append-only. Only the fixed-search-path
  post_customer_account_entry(jsonb) function may insert; runtime has no direct
  insert/update/delete.
- Credits update protected balance guards, not payment totals. Payments/allocations retain the
  existing finance journal, linked reversals and finance audit outbox. Every successful account
  append includes one atomic Operations outbox record.
- Invoice-first/payment-second guard locking prevents concurrent overspending. A universal
  allocation trigger enforces credited balances even on legacy finance paths. Deferred constraints
  require an account entry when a bound deposit is allocated or reversed.
- Invoice reversal requires reversing credits first. Receipt reversal requires reversing allocations
  first. A linked reversal may happen once.
- Subscriber balances, current dunning balances/evaluation and Collect's server-side invoice amounts
  subtract credits. Historical dunning events remain immutable; run evaluation to update case
  stages.
- Balance reads use a signed/scoped security-definer function; no raw guard-table grant is added.

## Deployment and rollback

Tenant-only migrations:

1. 202609021200_tenant_customer_accounts.sql
2. 202609021201_tenant_customer_account_balance_reads.sql

Migration 1201 adds scoped balance reads after the runtime-role check exposed denied raw guard
reads. No applied migration was rewritten. Deploy the compatible API, Operations web and Collect
server repository together; readiness requires the account and scoped-balance functions.

No production migration, deployment, customer financial change or server configuration was performed
for this checkpoint. Independent finance/tenant-isolation review and staging acceptance are required
before production promotion. Confirm backup/restore and migration duration on a representative copy.

Once a credit is posted, **do not roll back to code that ignores credited balances**. Do not delete
account history or reset guard counters. Prefer forward fixes and authorized linked reversals. Any
backup restoration must reconcile subsequent real receipts and audit evidence.

Observe API conflicts/denials, Operations and Finance audit-outbox lag, receipt reconciliation and
invoice outstanding balances. Failed inserts roll back both monetary effects and audit writes.

## Remaining finance scope

Paid-invoice credit carry-forward, cash/provider refunds, debit notes, opening balances, full
statements/pagination, legal credit-note PDF/archive, general ledger, AR/AP and period close remain
separate work. Existing provider/storage activation gates remain unchanged.

For captured checks see [checkpoint evidence](../testing/customer-accounts-2026-09-02.md).
