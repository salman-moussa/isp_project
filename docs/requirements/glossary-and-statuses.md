# Glossary and canonical status vocabulary

Use these terms in code, schemas, APIs, events, UI copy, tests, and documentation. English enum
values are stable storage/API values; localized display labels are translation resources. Never
infer permission or accounting behavior from a translated label.

## Product and actor terms

| Canonical term                               | Definition                                                                                              | Avoid                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Platform Client / ISP Client                 | An ISP company buying the software from Salman Moussa's Team.                                           | `Customer` where Subscriber could be meant.          |
| Tenant / ISP Workspace                       | The isolated operational environment and data boundary of one Platform Client.                          | Workspace ID supplied by a caller as proof of scope. |
| Subscriber / Customer                        | An end-user buying internet service from a tenant; has no product login.                                | Client, tenant customer, portal user.                |
| Control Plane / Platform Control Center      | Vendor-private commercial, provisioning, deployment, support and aggregate-health system.               | Super-admin access to raw tenant data.               |
| Tenant Data Plane / ISP Operations Workspace | Tenant operational services and records for subscribers, finance, collection, installation and network. | Control-plane database.                              |
| Collector Mobile App                         | Internal field app for assigned tenant collectors.                                                      | Subscriber app.                                      |
| Platform Subscription                        | Commercial right of an ISP Client to use this software.                                                 | Internet subscription.                               |
| Internet Service                             | The tenant-managed connectivity service sold to a Subscriber.                                           | Platform subscription.                               |
| Support Session                              | Explicit approved, scoped, time-limited cross-boundary access by platform support.                      | Impersonation, silent workspace opening.             |
| Posted                                       | Financial record has a permanent accounting identity and is immutable except by linked correction.      | Saved, completed.                                    |
| Reversal                                     | New linked record neutralizing all or part of a posted record; never mutation/deletion of the original. | Delete, cancel after posting.                        |
| Desired state                                | Intended RouterOS/subscriber network state requested by an authorized tenant workflow.                  | Assumed actual state.                                |
| Observed state                               | Last state retrieved from an authoritative router, including observation time and source.               | Live state without freshness.                        |
| Uncertain outcome                            | A command may have reached the provider/router but confirmation was lost.                               | Failed (unless proven).                              |

## Canonical lifecycle vocabularies

### Platform subscription

| Enum         | Meaning                                                                                         | Entry guard                                                            | Allowed next states                                       |
| ------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `lead`       | Prospect; no active tenant entitlement.                                                         | Qualified lead exists.                                                 | `trial`, `active`, `archived`                             |
| `trial`      | Time-bound evaluation under trial limits.                                                       | Package/deployment/owner and dates valid.                              | `active`, `terminated`, `archived`                        |
| `active`     | Purchased software access under effective entitlements.                                         | Commercial activation approved.                                        | `grace`, `terminated`                                     |
| `grace`      | Overdue but normal access continues for configured duration.                                    | Eligible unpaid balance and policy trigger.                            | `active`, `restricted`, `terminated`                      |
| `restricted` | Controlled software read/administration limitation; preserves data/payment/export/safety paths. | Grace expired and authorized transition.                               | `active`, `terminated`                                    |
| `terminated` | Commercial service ended; settlement, retention and export obligations remain.                  | Approved termination/effective date.                                   | `archived`, `active` only by explicit reactivation policy |
| `archived`   | Retained inactive history.                                                                      | No active service; retention/export obligations resolved or preserved. | `lead`/`active` only by audited reopen policy             |

No state in this vocabulary may enqueue or imply Subscriber internet-service suspension.

### Internet service

| Enum                   | Meaning                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `pending_installation` | Subscriber accepted but physical/network prerequisites incomplete.                |
| `pending_activation`   | Prerequisites complete; authorized provisioning not yet verified.                 |
| `active`               | Tenant intends service available; actual router state may be separately reported. |
| `grace`                | Tenant billing policy permits temporary service despite delinquency.              |
| `suspension_pending`   | Authorized tenant suspension requested; network job outstanding.                  |
| `suspended`            | Authorized tenant policy intends no connectivity and observed state agrees.       |
| `restore_pending`      | Eligible tenant restoration queued/reconciling.                                   |
| `terminated`           | Tenant ended Subscriber service; history retained.                                |
| `archived`             | Inactive retained record.                                                         |

### Financial documents and payments

| Aggregate         | Canonical states                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Invoice           | `draft`, `approved`, `posting`, `posted`, `partially_paid`, `paid`, `overdue`, `corrected`, `reversed`                               |
| Payment           | `draft`, `pending_verification`, `posting`, `posted`, `partially_allocated`, `allocated`, `reversal_pending`, `reversed`, `refunded` |
| Credit/debit note | `draft`, `approved`, `posted`, `applied`, `reversed`                                                                                 |
| Receipt           | `issued`, `reprinted`, `voided_by_reversal` (original remains retained)                                                              |
| Billing run       | `draft`, `previewed`, `queued`, `running`, `partially_succeeded`, `succeeded`, `failed`, `canceled`                                  |

`Canceled` is only valid before posting. `Corrected`, `reversed`, and `refunded` reference new
immutable records.

### Jobs and asynchronous work

| Enum                      | Meaning                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `draft`                   | Not submitted.                                                           |
| `queued`                  | Durably accepted, awaiting lease.                                        |
| `running`                 | Leased by a worker with heartbeat.                                       |
| `succeeded`               | Verified terminal success.                                               |
| `partially_succeeded`     | Batch children have mixed verified terminal results.                     |
| `failed`                  | Known terminal failure under retry policy.                               |
| `retry_scheduled`         | Known retryable failure awaiting bounded next attempt.                   |
| `reconciliation_required` | Outcome uncertain; observe before any repeat.                            |
| `canceled`                | Canceled at a documented safe point.                                     |
| `dead_lettered`           | Retry budget exhausted or poison input; authorized review/replay needed. |

### Mobile synchronization

| Enum              | Meaning                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `local_draft`     | Mutable local work not committed to outbox.                           |
| `pending`         | Encrypted durable operation waiting to sync.                          |
| `sending`         | Current attempt in progress.                                          |
| `accepted`        | Server returned canonical identity/result.                            |
| `conflict`        | Server requires explicit classified resolution.                       |
| `rejected`        | Terminal validation/authorization outcome; user action required.      |
| `retry_scheduled` | Transport/transient result with bounded retry.                        |
| `superseded`      | Replaced through explicit conflict resolution, retained for evidence. |

### Reconciliation and shifts

| Aggregate       | Canonical states                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shift           | `scheduled`, `open`, `closing`, `submitted`, `closed`, `reopened`                                                   |
| Reconciliation  | `draft`, `submitted`, `discrepancy_review`, `approved`, `rejected`, `closed`, `corrected`                           |
| Support ticket  | `new`, `triaged`, `assigned`, `in_progress`, `waiting_client`, `waiting_internal`, `resolved`, `closed`, `reopened` |
| Support session | `requested`, `approved`, `denied`, `active`, `expired`, `revoked`, `closed`                                         |
| Installation    | `new`, `scheduled`, `assigned`, `in_progress`, `blocked`, `ready_for_activation`, `completed`, `canceled`           |

## Currency and time vocabulary

- `USD` and `LBP` are mandatory ISO currency codes; display names may be localized.
- `minor_unit` is not assumed to be two decimals. The money ADR defines precision and rounding.
- `exchange_rate` is a dated, sourced, approved conversion basis, never an ambient singleton.
- `occurred_at` is the domain event time; `recorded_at` is server receipt time; `effective_at` is
  when a rule/change applies. Store UTC instants and render using the tenant timezone (default
  `Asia/Beirut`).

## Status-writing rules

1. Store stable lowercase snake-case enum values; translate only at presentation boundaries.
2. A state name describes known domain truth, not optimistic UI intent.
3. Every transition is an explicit command with actor, expected version, reason when sensitive,
   request/idempotency key, and audit result.
4. State machines reject unlisted transitions. Retried accepted commands return the prior result.
5. UI communicates status by text plus icon/description, never color alone.
