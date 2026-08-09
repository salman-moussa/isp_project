# Payment and billing integrity incident

1. Declare SEV-1 for duplicate/cross-tenant/cross-currency/imbalanced posting or lost immutable
   evidence. Freeze only affected posting/allocation/billing pathways; preserve reads, exports and
   safe recovery.
2. Capture request/idempotency keys, canonical payload hashes, transaction/audit/outbox IDs,
   currency, provider/mobile/webhook events and timeouts. Never include payment proofs/PII in
   general channels.
3. Determine whether the issue is display/reporting, duplicated business record, partial commit,
   allocation race, webhook replay, mobile replay or correction-chain violation.
4. Reconcile database constraints/ledger totals/audit/outbox/inbox/provider reference and collector
   records per tenant and currency. Do not combine USD/LBP or infer an exchange rate.
5. Fix through linked reversal/credit/debit/correction workflows under required approval. Do not
   update/delete posted records directly.
6. Deploy a guarded fix and add replay/concurrency/regression tests. Resume with low-volume
   synthetic/authorized validation, monitor duplicates/balances and reconcile backlog before normal
   flow.

Finance owner validates business correction; security reviews fraud/unauthorized-access possibility.
Document every affected record and correction chain in restricted evidence.
