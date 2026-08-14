# Runbook: payment/idempotency invariant

Owner: Finance + Security incident command. Treat any over-allocation, duplicate canonical effect,
currency crossover, mutable posted record or same-key/different-payload acceptance as critical. Stop
payment posting/reconciliation intake without deleting durable commands. Preserve database, audit,
outbox, request-hash and deployment evidence under restricted access.

Do not edit/delete posted records or auto-replay unknown effects. Reconcile canonical payment,
allocation, receipt, idempotency and audit records using opaque references; correct only with
approved linked reversal/forward repair. Resume after independent Finance/Security review,
concurrency/invariant tests and all affected commands are reconciled.
