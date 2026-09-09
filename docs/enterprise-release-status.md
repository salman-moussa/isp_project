# Orvex ISP enterprise release status

Status: live engineering ledger Controlling specification:
[`product/enterprise-capability-map.md`](product/enterprise-capability-map.md) Updated: 2026-09-08

This ledger records what the composed product can prove today. The only allowed capability states
are `foundation`, `partial`, `missing`, `activation_required`, and `verified`. A unit test is
supporting evidence, not end-to-end verification. External providers and hardware remain
`activation_required` until real acceptance evidence exists.

## Evidence key

- **B/F**: backend/frontend implementation.
- **P/DB**: enforced permission and canonical database objects.
- **Audit/worker**: immutable evidence and asynchronous or external execution boundary.
- **Acceptance**: composed E2E, failure/security, UI, and production evidence. `None` means the
  capability must not be represented as delivered.

## Office cashier and field collections — 2026-09-09

"Payments & cashier" and "Collectors" were the last two navigation items still rendering seeded
demonstration pages (invented subscribers, receipts, routes and figures), and the legacy office
payment path required a raw finance payment to be posted first while the collector stubs wrote a
fixed amount of 1. Migration 202609090600_tenant_cashier_collections.sql replaces both with governed
workflows.

Cashier (`execute_cashier_command`, action `tenant.cashier.manage`): `open_drawer` and
`close_drawer` keep one open drawer per cashier and currency with an opening float, the cash
receipts linked to it, the counted total and the variance; `record_receipt` posts the finance
payment, allocates it to the chosen invoice or to the subscriber's oldest open invoices first (any
remainder stays as credit on the account), links the scoped office source with method (cash, card,
bank transfer, OMT, Whish, other), reference, note and drawer, and issues the receipt number from a
per-tenant counter unless the cashier enters the number from a pre-printed book; `void_receipt`
(permission `tenant.payment.reverse`, recent MFA at the API) posts linked reversals of every active
allocation and of the payment and records the reason; a receipt in a closed drawer cannot be voided.
Both finance guards were extended so these actions post through the same accounting triggers as
every other receipt.

Collections (`execute_collection_command`, action `tenant.collection.manage`):
`assign_route_collector` keeps one active default collector per route; `assign_invoice` and
`assign_route_due` create assignments only for open, unassigned invoices in scope with the real open
balance and the route's collector unless one is named; `reassign`, `mark_visited`, `mark_returned`
and `cancel_assignment` (reason required, never after evidence); `record_collection` (permission
`tenant.payment.post`) posts the cash a collector handed in as a payment, allocation and evidence
with the real amount, capped at the open balance; `settle_route` derives the expected cash from that
day's evidence per collector, route and currency, keeps the declared cash and the difference,
accepts an exact match and otherwise requires a reason and a second manager's `approve_settlement`
(recent MFA at the API, never the settler or the collector). Collect device submissions awaiting
approval appear in the same list and are approved through the existing Collect endpoint.

Readers: `read_cashier_workspace(search)` (drawers in scope, today's totals per currency and method,
the last 100 receipts with allocations and voids, and a subscriber search by number, name or phone
returning open invoices per currency and unallocated credit) and `read_collections_workspace(day)`
(collectors with routes, open assignments, devices and last sync; routes with their collector and
unassigned open invoices; assignments due within a week, collected or cancelled in the last week;
office and device settlements of the last 30 days; Collect devices).

The web shell now renders "Payments & cashier" (drawers, subscriber search, receipt form with
allocation choice, printable receipt, receipt list with voids) and "Collectors" (assignments with
overdue marking and cash posting, routes with collector assignment and bulk due assignment,
settlements with approval, Collect devices). The seeded route pages, the demonstration copy and the
fabricated branch badge are removed from the shell; any module opened before sign-in shows a sign-in
panel. The legacy collector-evidence stub now records the posted payment's real amount and currency.

Live acceptance on PostgreSQL 18 (`test-live-cashier-collections.ts`, on a cloned governed invoice):
read refused without payment authority; drawer opened once per currency and only for a scoped
branch; partial cash receipt allocated to the invoice with exact replay, mismatched retry refused,
wrong permission and out-of-scope branch refused, card without reference refused, LBP against a USD
invoice refused; route collector required, non-member refused, assignment derived from the open
balance, duplicate assignment refused, other-branch reader sees nothing, visit marked, collection
capped at the open balance and refused without posting authority, second collection refused,
reassignment refused after evidence; settlement accepted on match, duplicate refused, difference
without reason refused, pending difference refused for the settler and for a stale version, approved
by a second manager with a version bump; card receipt with an explicit invoice leaving credit, void
refused without reversal authority, void restoring the balance and refused twice, drawer close
refused on a stale version, variance computed, second close refused; workspace shows the voided
receipt, allocations, method and today's totals; audit rows for every guarded table; event ledger
append-only.

Focused suites: api (receipt authority, card reference validation, void MFA gate, workspace search;
collection management versus cash posting, approval MFA gate, day query), tenant-web (cashier
search/post/print, Arabic void, drawer close; collections overdue/record cash, Arabic device
approval, bulk assignment and route collector), App shell navigation without seeded pages.

## Production checkpoint deployed — 2026-09-09 (`ec018d5`, live dashboard and governed reports)

Release id `20260909T080414Z-ec018d5`; the deploy script completed end to end with
`Deployment complete.`

| Item                | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Artifact            | sha256 `786e94dd80f33ce4eaaa0328369cc772cfef19cfe8a3eb41002f929c463a8a8f`, identical local and on-host |
| Backup              | `/opt/orvex-backups/20260909T080414Z-ec018d5`, verified with SHA256SUMS                                |
| Migrations promoted | 1 (`202609090500_tenant_analytics`); 12 applied files preserved at their applied bytes                 |
| Services            | all five `running (healthy)`                                                                           |
| Endpoints           | `/ready` 200 after 10s, `/` 200, `/control/` 200                                                       |
| Invariants          | unbalanced journals 0, invalid indexes 0                                                               |
| Logs                | no error/fatal/panic lines after deployment                                                            |

What is now live: the operations dashboard computed from the tenant's own records (no demonstration
figures anywhere in the shell) and the Reports workspace with nine governed datasets and recorded
CSV export.

Rollback boundary: `/opt/orvex-backups/20260909T080414Z-ec018d5/source.tar` plus both database dumps
and `env.backup`.

## Live dashboard and governed reports — 2026-09-09

The operations dashboard read a snapshot table that nothing ever wrote, so production showed zeros,
and the signed-out shell carried demonstration collections, activities and a "workflow states"
showcase. Migration 202609090500_tenant_analytics.sql adds `read_dashboard_snapshot` (permission
`tenant.dashboard.view`, action `tenant.dashboard.read`), which computes today's picture at read
time from the tenant's own records under the signed context: receipts posted today per currency and
channel (office cashier, collector routes, other) with the latest receipts; unpaid posted invoices
with their remaining balance per currency, the count older than 30 days and the oldest invoices;
active, suspended and pending services with live RADIUS sessions per NAS; failed work (dead-lettered
network jobs, failed notifications, failed billing runs, critical alarms), open and overdue tickets,
open incidents and today's field visits; and the latest audited actions. Currencies are reported
apart at every level.

`read_report_dataset` (permission `tenant.report.view` or export, action `tenant.report.read`)
serves nine governed datasets with a validated window of at most one year: receivables aging per
currency (0-30, 31-60, 61-90, 90+), collections by day, currency and channel, subscribers by branch
and status, plan mix with the monthly recurring amount, ticket SLA by priority (responded and
resolved in time, reopened, escalated), incidents with minutes to resolve against the SLA target,
dealer float and vouchers in the field, revenue assurance exposure by control, and notification
delivery by day, channel and status. `POST /reports/export` renders the dataset as RFC 4180 CSV in
the API, records the export as a succeeded job with the row count (audited through the export job
trigger), and hands the file to the browser; the export queue is therefore real evidence of what
left the system rather than a list nobody drained.

The tenant dashboard now renders only from the live snapshot (nothing is shown before sign-in;
"Demonstration data" is gone): four cards (collections today, unpaid invoices, live sessions, failed
work) whose records open in a drilldown, collections by channel, shift shortcuts and the latest
audited activity. The placeholder "Reports" page is replaced by a Reports workspace with the
catalogue, a date window for windowed reports, the rendered table with money shown in its currency,
CSV export and the export history.

Live acceptance on PostgreSQL 18 (`test-live-analytics.ts`): dashboard refused without dashboard
authority or with a support grant; collections today split by currency and channel with the office
receipt attributed to its subscriber; unpaid invoices, overdue count, remaining per currency and
oldest ordering; services and empty failed work; aging buckets, daily collections, invalid and
oversized windows refused, empty window, plan mix, subscriber status; unknown report and wrong
authority refused; CSV rendering with quoting; export recorded once with exact replay and one audit
row; other-branch reader seeing no subscriber-bound rows and zero active services.

Focused suites: api (dashboard, dataset key validation, export authority), tenant-web (dashboard
sign-out/live/retry, reports run/export/window, App navigation); typecheck, lint and formatting
gates pass.

## Production checkpoint deployed — 2026-09-09 (`93e0d4e`, customer service and communications)

Release id `20260909T071533Z-93e0d4e`; the deploy script completed end to end with
`Deployment complete.`

| Item                | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Artifact            | sha256 `bfab30004d0093dc580449b1cef484ca4eae9b01da0d15c326bd12498e78d859`, identical local and on-host |
| Backup              | `/opt/orvex-backups/20260909T071533Z-93e0d4e`, verified with SHA256SUMS                                |
| Migrations promoted | 1 (`202609090400_tenant_customer_service`); 16 applied files preserved at their applied bytes          |
| Services            | all five `running (healthy)`                                                                           |
| Endpoints           | `/ready` 200 after 10s, `/` 200, `/control/` 200                                                       |
| Invariants          | unbalanced journals 0, invalid indexes 0                                                               |

What is now live: tenant "Customer service" (categorised, verified tickets with SLA, notes,
escalation, outage links, reopen and redress) and "Communications" (approved bilingual templates,
subscriber consents, the notification outbox with masked destinations, and delivery through the
tenant's own SMTP/SMS integrations). Production has no approved templates or configured providers
yet, so delivery stays queued until an administrator activates them.

Rollback boundary: `/opt/orvex-backups/20260909T071533Z-93e0d4e/source.tar` plus both database dumps
and `env.backup`.

## Customer service and communications — 2026-09-09

Support issues existed as a status machine with no intake discipline, and there was no way to send a
customer anything. Migration 202609090400_tenant_customer_service.sql gives tickets a category, an
intake channel, caller verification (contact match against a live subscriber contact, ID document or
account reference, or explicitly none), response and resolution targets by priority (urgent 1 h / 4
h, high 4 h / 24 h, normal 8 h / 72 h, low 24 h / 5 days), first-response tracking, escalation to a
workspace member (which also assigns and raises the priority), an incident link, a reopen counter
and redress. `execute_support_command` (permission `tenant.subscriber.edit`, signed action
`tenant.support.manage`) creates tickets (subscriber or service, branch/area/route inherited from
the subscriber, `TCK-YYYYMMDD-XXXXXX`), adds internal notes (a customer contact counts as the first
response), escalates, links incidents, reopens a resolved ticket back into progress under the
existing transition guard and records redress with a document reference. Status changes keep using
the governed transition route; that route's row lock now uses an advisory lock because the runtime
role never held the UPDATE privilege the old `FOR UPDATE` needed, which had left the transition path
unusable.

Communications: bilingual message templates per channel (SMS, WhatsApp, email with subjects) are
authored by an administrator and must be approved by a different administrator; any edit returns a
template to draft. Subscriber consent is an append-only per-channel decision with a source; the
latest decision wins. `queue_notification` renders an approved template with `{{placeholders}}`
(subscriber name and number always available; unknown placeholders stay visible), resolves the
destination from the subscriber's live primary contact for the channel (WhatsApp falls back to the
phone), and suppresses the message with a recorded reason when consent was withdrawn or no contact
exists. The delivery pass (`POST /communications/deliver`, permission `tenant.secret.manage`) reads
the tenant's configured provider for each channel, sends each due message through the same
transports as the integration test, and records the outcome per attempt with a deterministic key
(`notification-delivery:<message>:<version>`): a success stores the provider reference; a failure
stores the error and re-queues with a growing delay until the fifth attempt parks the message as
failed. Unmasked destinations are readable only under secret authority; every other read sees a
masked destination.

The tenant "Customer service" screen (replacing the placeholder internal-support page) is a
bilingual, RTL-aware ticket workspace: summary strip (open, waiting, response overdue, resolution
overdue, escalated), a queue ordered by priority with breach badges, a verified intake form, and a
detail pane with facts, notes, status history and actions (note, status change through the governed
route, escalate, link incident, reopen, redress). The new "Communications" screen carries the outbox
(queue a message from an approved template with variables, cancel, "Send queued now"), templates
(new, edit, approve, retire) and consent decisions, with the provider configuration state shown for
each channel.

Live acceptance on PostgreSQL 18 (`test-live-customer-service.ts`): view-only and wrong-contact
refusals, verified ticket with exact replay and changed-payload conflict, SLA arithmetic, notes and
first response, non-member escalation refused, escalation assigning the manager, unknown incident
refused, triage → in progress → resolved through the transition route, escalation of a resolved
ticket refused, reopen with history and counter, redress reference required and recorded, note
count, other-branch reader and support grant refused, out-of-scope note refused; template governance
refused for agents, self-approval refused, approval by another administrator, stale edit refused,
email template subjects; unapproved template refused, rendered Arabic body with subscriber and
variables, masked destination, provider state, consent withdrawal suppressing and the latest consent
winning; queued reads refused without secret authority, failed attempt re-queued with delay, sent
with provider reference and exact replay, non-queued refusal, cancellation; scope and immutability;
at least sixteen audit rows.

Focused suites: api (support and communications route separation and schema refusals), tenant-web (5
workspace tests, App navigation); typecheck, lint and formatting gates pass.

## Production checkpoint deployed — 2026-09-09 (`9f352b8`, network, NOC telemetry, dealers, revenue assurance)

Release id `20260909T001032Z-9f352b8`; the deploy script completed end to end with
`Deployment complete.`

| Item                | Result                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Artifact            | sha256 `3a909734c5460a59da77d7e22318628decdfe02f2e6a85e33f5c8046d5476c86`, identical local and on-host                                                                                                             |
| Backup              | `/opt/orvex-backups/20260909T001032Z-9f352b8`, verified with SHA256SUMS                                                                                                                                            |
| Migrations promoted | 4 (`202609080200_tenant_network_resources`, `202609090100_tenant_noc_telemetry`, `202609090200_tenant_dealer_channel`, `202609090300_tenant_revenue_assurance`); 12 applied files preserved at their applied bytes |
| Services            | all five `running (healthy)`                                                                                                                                                                                       |
| Endpoints           | `/ready` 200 after 10s, `/` 200, `/control/` 200                                                                                                                                                                   |
| Invariants          | unbalanced journals 0, invalid indexes 0                                                                                                                                                                           |
| Logs                | no error/fatal/panic lines after deployment                                                                                                                                                                        |

What is now live: tenant "Network" (routers, NAS, IP pools, bindings, sessions, CPE, worker jobs),
"NOC incidents" with worker-derived alarms, maintenance windows and SLA targets, "Dealers &
vouchers" and "Revenue assurance". Production has no routers, dealers or subscribers yet, so these
screens open empty by design; router registration needs bulk-approval authority with a recent MFA
step-up, and template/provider activation stays a human task.

Rollback boundary: `/opt/orvex-backups/20260909T001032Z-9f352b8/source.tar` plus both database dumps
and `env.backup`.

## Revenue assurance: leakage controls, findings and exposure cases — 2026-09-09

Finance had reconciliation constraints but no place that asked "where is money leaking today?".
Migration 202609090300_tenant_revenue_assurance.sql adds eight deterministic controls evaluated from
the tenant's own records by `assurance_evaluate`: active service not billed in 35 days (exposure =
plan recurring amount), invoice posted after termination, invoice unpaid over 60 days (exposure =
remaining after allocations and credits), payment unallocated over 7 days, possible duplicate
payment (same amount, same day, same invoice), voucher credit pending over an hour, collector cash
variance in the last 30 days and dealer float beyond its credit limit, each per currency with USD
and LBP never combined. Findings are keyed by control and subject and persist across runs: a repeat
refreshes exposure and version, a condition that disappears clears itself, a cleared condition that
comes back reopens, and acknowledged or resolved findings keep their state. Controls only read; they
never post or reverse money.

`execute_assurance_command` (permission `tenant.collection.reconcile`, signed action
`tenant.assurance.manage`) runs the controls (serialised per tenant, recorded as a run with its
summary), acknowledges a finding with a note, opens an exposure case from live findings not already
in a case (`RA-YYYYMMDD-XXXXXX`, optional owner who must be a workspace member), assigns an owner,
links more findings, moves a case open → investigating → resolved or written off (closing requires a
bilingual resolution and evidence and marks the case's findings resolved), and refuses changes to a
closed case. Every command is exact-replayable, versioned, written to the append-only assurance
event ledger and the audit outbox. Reads need `tenant.billing.view` (or reconciliation, accounting
or report view); findings bound to a branch follow the standard scope, tenant-wide findings
(payments, unlinked invoices) stay visible to every scoped reader, and support grants are refused.

The tenant "Revenue assurance" screen (new navigation entry) is a bilingual, RTL-aware workspace: a
summary strip (open and acknowledged findings, open cases, exposure USD and LBP), the control
catalogue with per-control open/new counts and exposure from the last run plus "Run controls" with a
reason, a findings table (filter by control, live or including cleared and resolved, acknowledge
with a note, multi-select to open a case with an owner) and a case board with detail, findings in
the case, assign, start investigation, resolve or write off with evidence.

Live acceptance on PostgreSQL 18 (`test-live-assurance.ts`) on backdated fixtures: authority and
support-grant refusals; a first run raising three findings with the expected exposures (2,500 stale
service, 2,000 overdue remainder, 500 unallocated) and exact replay; a second run refreshing
versions without duplicating; stale-version and non-open acknowledgement refusals; a payment
becoming fully allocated clearing its finding and reopening when the allocation is reduced while the
acknowledged finding is kept; case opening refused for unknown findings and non-member owners, case
opened with two findings, duplicate case refused, owner assigned, evidence-less close refused,
investigation started, invalid transition refused, third finding linked, case resolved with evidence
marking all three findings resolved, closed case immutable, resolved findings staying resolved on
the next run; other-branch reader seeing only tenant-wide findings; ledger and finding rows
immutable; eleven audit rows.

Also in this checkpoint: the live acceptance chain is made honest on a fresh database — the NOC
proof no longer depends on another tenant's service existing, and the customer-accounts proof runs
before the financial-journals proof consumes the only synthetic sales invoice.

Focused suites: api (assurance route authority, evidence refusal and scoped read), tenant-web (3
assurance workspace tests, App navigation); typecheck, lint and formatting gates pass.

## Dealer channel: float ledger, PIN vouchers and guarded redemption — 2026-09-09

The dealer and voucher tables existed with no vertical behind them: batches were inserted by
application code with PINs drawn from Math.random, nothing was idempotent or audited, and no screen
used them. Migration 202609090200_tenant_dealer_channel.sql turns the channel into a governed
domain: dealers gain a type (dealer, reseller, point of sale), contact, optional branch, status,
credit limits per currency, commission and a version; a per-dealer, per-currency append-only float
ledger (deposit, batch issue, commission, batch cancellation, approved adjustment) with the balance
after every entry; batches gain a status, a per-batch salt, expiry and a version; vouchers gain
issue/cancel times, PIN attempt counters and a lock; a redemption record tracks the subscriber
credit until it is posted; and an append-only dealer event ledger whose CHECK constraints refuse a
stored PIN or PIN list. The API runtime's SELECT grant on vouchers and batches is a column list that
omits the hash and the salt.

`execute_dealer_command` (signed action `tenant.dealer.channel.manage`) registers and updates
dealers (branch must be in scope; codes upper-cased and unique), records deposits (unique receipt
reference), takes approved adjustments only under `tenant.collection.reconcile` (the API also
requires recent MFA), generates batches in the database (twelve-digit PINs from `gen_random_bytes`,
stored as salted SHA-256, returned exactly once and never on replay), issues a batch to an active
dealer (float charged face value, commission credited back, refused when float plus credit limit
cannot cover it, refused for a suspended dealer), cancels the unredeemed remainder of a batch (float
credited back net of commission; redeemed vouchers stay redeemed), redeems a voucher for a scoped
subscriber (wrong PINs are committed as attempts and lock the voucher on the fifth; redeemed,
cancelled, expired and unissued vouchers are refused) and confirms the subscriber credit against a
matching `deposit_received` customer account entry.

Redemption is a three-step saga with visible state rather than a hidden cross-ledger write: the API
marks the voucher redeemed (atomic, PIN-guarded), posts the subscriber deposit through the existing
customer account function under its own signed action with the deterministic key
`voucher-credit:<redemption>`, then confirms the redemption with `voucher-confirm:<redemption>`. A
failure after the first step leaves the redemption "credit pending" on the board with a "Complete
credit" action that replays the same keys, so no subscriber is credited twice and no redeemed
voucher is silently lost.

The tenant "Dealers & vouchers" screen (new navigation entry; the invented navigation badges were
removed) is a bilingual, RTL-aware workspace: a summary strip (active dealers, vouchers in the
field, credits pending, float USD and LBP shown separately), a dealer registry with per-currency
balance and available credit, register/update, deposit and approved adjustment forms; voucher
batches with generate (PIN panel shown once with a hand-over confirmation), issue and cancel; a
redemption form with subscriber search and the recent redemptions with pending-credit retry; and the
float ledger.

Live acceptance on PostgreSQL 18 (`test-live-dealers.ts`): registration with exact replay,
changed-payload conflict, duplicate code, view-only and support-grant refusals, out-of-scope branch
refusal, stale-version refusal and update; zero deposit refused, deposit with balance, duplicate
receipt refused, adjustment refused without reconciliation authority and accepted with it; a
60-voucher batch with unique twelve-digit PINs, replay without PINs, duplicate batch number refused,
hashed storage, runtime SELECT of the hash refused, event ledger without PINs; issue net of 5%
commission with the expected balance, re-issue refused, over-limit second batch refused, suspended
dealer refused; two wrong PINs with the countdown, redemption, double redemption refused, five wrong
PINs locking a voucher and the right PIN then refused, other-branch cashier refused; deposit replay,
mismatched entry refused, confirmation and its replay; cancellation of 59 vouchers refunding net of
commission, cancelled voucher not redeemable; workspace balances per currency with no mixing,
counts, pending credits zero, other-branch reader seeing no dealer; ledger and voucher rows
immutable; at least sixteen audit rows.

Focused suites: api (dealer route separation: channel commands, PIN batch with one-time PINs, schema
refusals, reconciliation authority plus MFA for adjustments), tenant-web (3 dealer workspace tests,
App navigation); typecheck, lint and formatting gates pass.

## NOC telemetry: worker alarms, maintenance windows and SLA — 2026-09-09

Incidents could be recorded and moved through their lifecycle, but nothing in the product told the
NOC that a router had stopped answering, and planned work could not be distinguished from a fault.
Migration 202609090100_tenant_noc_telemetry.sql turns real RouterOS worker outcomes into alarms: a
trigger on the durable job table (firing only under the worker identity) raises one deduplicated
alarm per router and problem class when an attempt fails as offline/timeout/transport/circuit-open
(`ROUTER_UNREACHABLE`, escalated to critical on dead letter), authentication/authorization
(`ROUTER_ACCESS_DENIED`) or observed-state mismatch (`SERVICE_STATE_MISMATCH`), refreshes the
occurrence count and last-seen time on repeats, and clears the router's worker alarms when a job
succeeds. Alarms carry the router, route and service they came from. Orvex still does not poll
devices; every worker alarm is evidence of an execution the worker actually attempted.

`execute_noc_alarm_command` (permission `tenant.network.job.create`, signed action
`tenant.noc.alarm.manage`) adds the operator side: raise an alarm observed outside the worker
(upper-case code, bilingual message, optional route/router/service; an equivalent open alarm is
refused), acknowledge with a note, clear, and link an alarm to an open incident; plan maintenance
windows (title EN/AR, optional router and route, start/end, expected impact, notes) and move them
planned → in progress → completed or cancelled. An alarm raised inside an active window is tagged
with that window so the board shows it as expected rather than as a new fault. Every command is
exact-replayable, versioned, written to the append-only NOC event ledger and to the audit outbox.
Incidents now carry a resolution target by severity (critical 1 h, major 4 h, minor 24 h, warning 72
h) and a breach flag, plus the count of linked alarms.

Scope: alarms and windows bound to a route follow the route scope; unscoped device alarms and
router-only windows are tenant-wide; support grants cannot act. The worker reaches alarm, window and
service rows only through identity policies on the SECURITY DEFINER trigger, never a table grant,
and the API runtime cannot write alarms directly.

The tenant "NOC incidents" screen is now an assurance workspace with a summary strip (active,
critical, acknowledged, in maintenance, SLA breached) and three views: incidents (unchanged queue
and detail, now with resolution target, breach badge and linked alarms), alarms (live or including
cleared; severity, source, occurrences, service, route; acknowledge with note, link to an open
incident, clear; raise an operator alarm) and maintenance (planned/running windows with suppressed
alarm counts; plan, start, complete, cancel).

Live acceptance on PostgreSQL 18 (`test-live-noc-telemetry.ts`): a real outbox suspension becomes a
worker job; the worker's claim/save cycle with offline then timeout outcomes raises one alarm and
refreshes it (occurrences 2, version 2); stale acknowledgement refused, acknowledgement with exact
replay and changed-payload conflict, viewer and support-grant refusals; a worker success clears the
alarm; a past-only window refused, a window covering the router created, a dead-lettered restore
raising a critical alarm tagged with the window (summary suppressed 1); window start/complete with
invalid and closed transitions refused; operator alarm raised, duplicate and lower-case code
refused, linked to a critical incident (linked alarms 1, SLA target one hour, not breached), cleared
and then not linkable; other-branch reader sees no route-bound alarm but the router-only window;
ledger and alarm rows immutable; seven ledger and audit rows; runtime direct write refused.

Focused suites: api (NOC alarm route authority and schema refusal), tenant-web (7 NOC workspace
tests); typecheck, lint and formatting gates pass.

## Network resources: routers, NAS, IPAM, sessions and CPE — 2026-09-08

The RouterOS worker could execute activation and suspension jobs, but routers, NAS clients, address
pools and CPE devices could only be seeded by an operator with database access, and nobody could see
the worker queue or subscriber sessions from the product. Migration
202609080200_tenant_network_resources.sql adds an append-only network event ledger, purpose-typed IP
pools with live allocations (reserved/allocated/released, one live row per address), NAS registry
and RADIUS session columns, and `execute_network_command` with two signed actions:
`tenant.network.infrastructure.manage` (register/update router, upsert NAS client; requires
`tenant.network.bulk.approve` and recent MFA at the API) and `tenant.network.resource.manage`
(create/update pool, reserve address, allocate the next free address to a service, release, bind a
service to a router with PPP account and profile, register/update CPE, cancel a job, re-queue a
dead-lettered job under approval authority). Router, NAS and PPP credentials are accepted only as
secret-manager references (`secret://…`, `vault://…`, `env://…`); a plaintext credential is refused
at the API and the event ledger rejects any payload key that looks like a secret.

RADIUS accounting lands through `network_worker.record_accounting`, callable only by the worker
identity: start/interim/stop records are validated, refused from an unregistered or inactive NAS,
matched to the bound service and upserted by accounting session id (octet counters monotonic, stop
time and terminate cause set once). Worker access to NAS, session and service rows is by identity
policy, never by table grant, so the worker still cannot read or write those tables directly.
Re-queue keeps the previous attempts on the job under `previousAttempts` and counts manual retries,
so a job's history is never rewritten.

The tenant "Network" screen (nav id `mikrotik`) is a bilingual, RTL-aware workspace with tabs for
worker jobs (open / needs attention / closed, cancel and re-queue with reason and evidence), routers
(register/update, bound services and open jobs per router), service bindings (bind form with PPP
account, profile and static address), IP pools (utilisation bars, create pool, reserve and
allocate), NAS clients and live sessions, and CPE devices (register/update with service link, TR-069
id and asset). Every mutation carries a bilingual reason and evidence and an exact idempotency key.

Live acceptance on PostgreSQL 18 (`test-live-network-resources.ts`): router registration with exact
replay and changed-payload conflict, infrastructure action refused for job-only authority, NAS
upsert/update with stale-version refusal, pool creation with overlapping-subnet refusal, reservation
and next-free allocation skipping reserved/gateway addresses, double allocation refused, release and
re-allocation, binding a service with static address, job cancel and re-queue of a dead-lettered
suspension preserving prior attempts, CPE register/update keeping fields not present in the payload,
worker accounting start/interim, unregistered NAS refused, non-worker caller refused, the read model
(routers with bound services and open jobs, bindings, jobs, pool utilisation, allocations, NAS
active sessions, session octets, CPE service numbers, events, services), another branch seeing
neither the binding nor the job, support-grant refusal and append-only events.

Focused suites: api (network route separation: approval plus fresh MFA for infrastructure, job
authority for resources, plaintext credential refused), tenant-web (3 network workspace tests);
typecheck, lint and formatting gates pass.

## Production checkpoint deployed — 2026-09-08 (`01731f5`, field manual and design pass)

Release id `20260908T141220Z-01731f5`; the deploy script completed end to end with
`Deployment complete.` No migration was promoted (latest applied stays
`202609080100_tenant_field_service.sql`; 12 applied files preserved at their applied bytes). All
five services `running (healthy)`; `/ready`, `/` and `/control/` returned 200; unbalanced journals 0
and invalid indexes 0. The bilingual field manual is live at `https://isp.mosesgr.com/guide.html`
(HTTP 200 from the public entry point). Backup and rollback boundary:
`/opt/orvex-backups/20260908T141220Z-01731f5` (source.tar, both database dumps, env.backup).

## Production checkpoint deployed — 2026-09-08 (field service dispatch)

Production moved to the field service checkpoint (artifact built from the commit later rewritten as
`8f47a37` when the branch history was cleaned and the branch renamed to `production-ui-completion`;
the deployed tree is byte-identical). Release id `20260908T081403Z-81d919f`. The deploy script
completed end to end with `Deployment complete.`

| Item                | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Artifact            | sha256 `48728a5d3e8bd32e6eaafbe843af8c2d0162e6cd4c76e4dd3192efda2e268e17`, identical local and on-host |
| Backup              | `/opt/orvex-backups/20260908T081403Z-81d919f`, 7/7 entries verified with `sha256sum -c`                |
| Preflight           | control 14/14 matched, 0 pending; tenant 55/55 matched, 1 pending — no blocking findings               |
| Migrations promoted | `202609080100_tenant_field_service.sql` (tenant 55 → 56); `execute_field_service_command` present      |
| Services            | all five `running (healthy)`                                                                           |
| Endpoints           | `/ready` 200 after 10s, `/health` 200, `/` 200, `/control/` 200                                        |
| Invariants          | invalid indexes 0                                                                                      |
| Migration bytes     | 12 CRLF preserved, new migration 0 CR bytes                                                            |
| Logs                | no error/fatal/panic lines after deployment                                                            |

What is now live: tenant "Installations" is the dispatch workspace (board, work orders, technician
registry). Production still has no branches/areas/routes, subscribers or installations, so the board
opens empty by design; technician registration requires a workspace member and, for a scoped
dispatcher, a home branch.

Rollback boundary: `/opt/orvex-backups/20260908T081403Z-81d919f/source.tar` plus both database dumps
and `env.backup`.

## Field service dispatch — 2026-09-08

Installations could be moved through their lifecycle from a sales order, but nobody could see the
day's field work in one place, choose who does it, or prove what happened on site. Migration
202609080100_tenant_field_service.sql adds a technician registry (skills, phone, home branch,
territory areas) and work orders (installation, repair, relocation, maintenance, disconnection,
survey) with priority, appointment window, SLA due time, required skills, a bilingual checklist and
an outcome. `execute_field_service_command` runs under `tenant.installation.manage` with two signed
actions: `tenant.field.dispatch` (register/update technician, create, schedule, assign, cancel) and
`tenant.field.execute` (arrive on site, complete, fail). Execution is limited to the assigned
technician or a tenant-wide dispatcher.

Installation work orders drive the installation record through the existing event ledger
(`field_service_transition_installation`): scheduling → `scheduled`, arrival → `in_progress`,
completion → `ready_for_activation`, failure → `blocked` with the reason, and dispatching the
revisit → `scheduled` again, so sales-order task synchronisation and network activation keep working
unchanged. Completion refuses to close while a required checklist item is not done; a failure
creates an unassigned revisit with the same checklist; only one live work order may exist per
installation; a technician lacking a required skill cannot be assigned; a dispatched technician
cannot be deactivated. Work order numbers are generated (`WO-YYYYMMDD-XXXXXX`) and every command is
exact-replayable with a bilingual reason and evidence.

Scope: work orders inherit branch/area/route from the subscriber (or installation) and follow the
standard scope predicate, so a branch-scoped dispatcher sees only their branch; a technician always
sees their own registry row. The read model returns the board for one day (unscheduled work plus
everything whose window touches the day), technicians with active load, timelines, workspace members
eligible for registration, open installations without live work, and scope catalogues.

The tenant "Installations" screen is now a real bilingual, RTL-aware dispatch workspace: hero counts
(waiting, dispatched, on site, overdue SLA), day/status/technician filters, a board with an
unassigned column and one column per active technician, a work order table, the technician registry
with register/update forms, and a detail drawer with facts, checklist, outcome, timeline and
status-appropriate actions (schedule/reschedule, assign/unassign, arrive, complete with checklist
and measurements, could-not-complete with revisit window, cancel).

Live acceptance on PostgreSQL 18 (`test-live-field-service.ts`): registration with exact replay and
changed-payload conflict, duplicate and non-member refusals, action/signature mismatch, duplicate
live work per installation refused, missing-skill assignment refused, start-before-dispatch refused,
schedule/dispatch synchronising the installation and installer, stale version refused,
unassign/reassign, non-assigned scoped technician refused while the assigned scoped technician can
start, incomplete checklist refused, failure creating a scheduled revisit and blocking the
installation, revisit dispatch/start/complete with replay, the six-step installation event sequence,
closed work not cancellable, board/day/status reads with subscriber, service, address, installation
status, outcome and checklist, other-branch readers seeing nothing, technician self-visibility,
support-grant and wrong-action refusals, eleven audit outbox rows and append-only events.

Focused suites: api (field service route separation), tenant-web (4 dispatch workspace tests);
typecheck, lint and formatting gates pass.

## Production checkpoint deployed — 2026-09-08 (`9f6e958`)

Production moved from `e179b51` to `9f6e958`, promoting product-managed integration settings and
database-backed authentication delivery. Release id `20260908T065954Z-9f6e958`. The deploy script
completed end to end; the integration sealing key was generated on the host (`openssl rand`) and
appended to the preserved `.env` without ever being printed, with the prior `.env` backed up first.

| Item                | Result                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact            | sha256 `6c368fa2ecb652e4859ea32d96085e81e532f7c4b3f592b1a3124809c561fffd`, identical local and on-host                                                            |
| Backup              | `/opt/orvex-backups/20260908T065954Z-9f6e958`, 7/7 entries verified with `sha256sum -c`                                                                           |
| Preflight           | control 13/13 matched, 1 pending; tenant 54/54 matched, 1 pending — no blocking findings                                                                          |
| Migrations promoted | `202609070100_control_integration_settings.sql` (control 13 → 14), `202609070200_tenant_integration_settings.sql` (tenant 54 → 55)                                |
| Permission grants   | both platform administrators now hold `platform.integration.manage` (authorization versions bumped); the tenant administrator already held `tenant.secret.manage` |
| Readiness           | `platform_integration_readiness()` relations and functions ready                                                                                                  |
| Services            | all five `running (healthy)`                                                                                                                                      |
| Endpoints           | `/health` 200, `/ready` 200, `/` 200, `/control/` 200, `/v1/control-center/integrations` 401 unauthenticated                                                      |
| Invariants          | invalid indexes 0 in both databases                                                                                                                               |
| Migration bytes     | 12 CRLF preserved, both new migrations 0 CR bytes                                                                                                                 |
| Logs                | no error/fatal/panic lines after deployment                                                                                                                       |

What is now live: Control Center → Administration → Integrations and tenant Configuration →
Integrations. The remaining activation step is human: a platform administrator signs in (existing
sessions ended with the permission bump), saves real SMTP settings, and sends a test email. Until
then MFA step-up, recovery and invitations return an explicit `503` instead of pointing at a
placeholder provider.

Rollback boundary: `/opt/orvex-backups/20260908T065954Z-9f6e958/source.tar` plus both database dumps
and `env.backup`.

## Product-managed integration settings — 2026-09-07

Verification mail had nowhere to go: production pointed authentication delivery at a placeholder
URL, so MFA step-up, recovery and staff invitations could never complete, and nothing in the product
let an administrator fix that. Migration 202609070100_control_integration_settings.sql adds platform
provider settings (SMTP, SMS, WhatsApp) under a new canonical permission
`platform.integration.manage`, one-time-code digests (`auth_otp_codes`), append-only delivery
evidence with masked recipients, and runtime-role readers the API uses before any session exists.
Migration 202609070200_tenant_integration_settings.sql adds the same per tenant under
`tenant.secret.manage` (reads under `tenant.user.administer`), with RLS that hides provider settings
from every branch-, area-, route- or record-scoped signature and from support grants.

Credentials never reach PostgreSQL in the clear: the API seals them with AES-256-GCM under
`INTEGRATION_SECRET_KEY_BASE64`, stores ciphertext plus key id and field names, and no read returns
them. Retries are exact without storing the secret: a keyed fingerprint of the credential is bound
into the signed request identity (platform) or the replayable payload (tenant), so the same key with
different credentials is a conflict, not a silent replay. Every change is versioned with optimistic
concurrency, audited without secret bytes, and a stored credential can be kept, replaced or cleared
explicitly.

Delivery is real: a small SMTP client (EHLO, STARTTLS, implicit TLS, AUTH PLAIN/LOGIN, base64 MIME
with RFC 2047 headers) plus Twilio, generic HTTPS-JSON and Meta WhatsApp Cloud providers.
Authenticated SMTP over cleartext is refused in production. `DatabaseAuthDeliveryAdapter` now emails
six-digit codes (digest stored, five attempts, consumed once), recovery links and staff invitations
through the platform SMTP settings; without them it fails closed with a clear 503, or falls back to
the optional external provider. A public bilingual recovery page (`#/recovery/<token>`) completes
the loop in both web applications.

Control Center → Administration and tenant Configuration → Integrations share one bilingual,
RTL-aware panel: per-kind status (version, stored credential fields, last test), write-only secret
fields with a keep-stored default, provider selection for SMS/WhatsApp, "send a test" to a real
recipient, change history and (platform) delivery evidence. Tenant Configuration also keeps the
versioned non-secret operations defaults.

Live acceptance on PostgreSQL 18 (`test-live-integrations.ts`, rerun-safe): platform configure with
exact replay, changed-credential conflict, stale-version refusal, keep-secret preservation, wrong
permission refused in the database, test recording with delivery evidence, reads never exposing
ciphertext; runtime-role delivery reads, OTP verify with attempt exhaustion, single consumption and
expiry, append-only deliveries; tenant configure/replay/conflict, in-payload secret refused,
branch-scoped and administer-only signatures refused, inactive settings invisible to delivery,
recorded tests, action/signature mismatch refused, four audit outbox rows, and a branch-scoped
reader seeing nothing. The run also exposed and fixed Control Center error mapping (driver-wrapped
SQLSTATEs now map to 404/409/412 instead of 500).

Existing platform administrators and ISP owner/administrator memberships receive the new permissions
in the migration; their sessions end by design. Production remains `activation_required` for
delivery until an administrator saves and tests real SMTP settings.

Focused suites: contracts, database, ui (6 panel/recovery tests), api (integration client, secret
box, messaging, delivery adapter and route suites), platform-web and tenant-web all pass; lint,
typecheck and formatting gates pass.

## Vendor quote requests and comparison — 2026-09-05

Purchase orders could be created, but only by someone who already knew the price. Migration
202609051400_tenant_vendor_quotes.sql adds quote requests, per-vendor quotes with priced lines, and
execute_vendor_quote_command at POST .../warehouse/quotes (tenant.catalog.manage +
tenant.warehouse.quote.manage).

Awarding turns the chosen quote into a draft purchase order at the quoted prices, so nobody retypes
them and the order still goes through the normal approval path. Losing quotes are marked rejected in
the same transaction. Quotes are read cheapest first, and each carries its own currency: USD and LBP
quotes are compared side by side, never summed.

A quote must price every requested line or it is not comparable, one quote per vendor per request (a
second submission is a correction, not a rival bid), and an expired quote cannot be awarded.

Live acceptance on PostgreSQL 18 proves: request creation with exact replay and changed-payload
conflict; a procurement signature refused for the quote action; an unpriced quote refused; two
quotes at 160000 and 145000; a duplicate vendor submission refused; awarding the cheaper quote
creating a draft order at 145000 with the quoted 1450 unit cost and the winning vendor; a second
award refused; and the workspace showing the awarded quote first with the loser marked rejected.

Also records goods rejected on arrival in operations_purchase_receipt_rejections without letting
them into stock, leaving the purchase-order line outstanding so the vendor can re-ship — which is
what a backorder is.

Focused suites: contracts 23/23, database 75/75, api 103/103, tenant-web 82/82 (32 warehouse tests).
Build and all static gates pass.

## RMA lifecycle and reorder suggestions — 2026-09-05

A serialized asset could be moved to the `rma` status, but that was a dead end: no case, no vendor,
no outcome, and no way to write off a device that never came back. Migration
`202609051300_tenant_rma_repair.sql` adds `operations_rma_cases` and the append-only
`operations_rma_events`, plus `execute_rma_command` covering open → send → repaired / replaced /
scrapped → closed. Serialized assets gain a terminal `scrapped` state.

Scrapping is the only step that touches the books, so it is finance work with step-up at
`POST …/warehouse/rma/scrap` (`tenant.accounting.post` + `tenant.warehouse.rma.scrap`) and posts the
device's standard cost to inventory variance. Everything else is warehouse work at
`POST …/warehouse/rma` (`tenant.installation.manage` + `tenant.warehouse.rma.manage`), and each
route refuses the other's command. A partial unique index allows one open case per asset: a device
cannot be at two vendors at once.

Reorder suggestions are a derived read model, not a stored table: available quantity (on hand less
reserved) minus what is already outstanding on approved or partially-received purchase orders,
compared with the item's reorder threshold. Nothing there commits a purchase.

Live acceptance on PostgreSQL 18 proves: opening moves the asset to `rma`; exact idempotent replay
and changed-payload conflict; a second case for the same asset refused; the warehouse signature
refused for scrapping; closing before resolution refused; "repaired" before shipping refused;
shipping, then a replacement that scraps the faulty unit and puts the vendor's unit in stock at the
same warehouse; closing; a second case ending in a write-off with a balanced 4400/4400
`inventory_scrap` journal; append-only RMA events rejecting tampering; and a reorder suggestion of 8
for an item at 2 on hand against a threshold of 10.

Two scope gaps surfaced by running it: `procurement_scope_allows` did not admit the RMA action, so
the case could not read the vendor register it names; and nulling `warehouse_id` on a scrapped asset
put the row outside its own row-level security scope. The last known warehouse is now retained,
which is better data anyway — a write-off has a place attached to it.

Focused suites: contracts 23/23, database 75/75, api 103/103, tenant-web 78/78 (28 warehouse tests).
Build and all static gates pass.

## Controlled stock counts — 2026-09-05

Adjustments existed, but a real count is not a series of ad-hoc adjustments: it is a session that
freezes what the system believed, records what was physically found, and posts the difference once.
Migration `202609051200_tenant_stock_counts.sql` adds `operations_stock_counts` and
`operations_stock_count_lines` (with `variance` as a generated column) plus
`execute_stock_count_command`.

Authority splits the same way as adjustments. Opening, recording and cancelling are warehouse work
at `POST …/warehouse/stock/counts` (`tenant.installation.manage` + `tenant.warehouse.stock.count`).
**Closing posts the variance**, so it is finance work with step-up at
`POST …/warehouse/stock/counts/close` (`tenant.accounting.post` +
`tenant.warehouse.stock.count.close`). The valuation currency is declared when the count is opened,
so a count never mixes USD and LBP, and one netted journal is posted per close.

A partial unique index allows only one open count per location: two concurrent counts of the same
shelf could not both be trusted, and their closes would fight over the same balances.

Live acceptance on PostgreSQL 18 proves: opening seeds one line from the live balance with
`system_quantity` 3; a second open count for the same location refused; the warehouse signature
refused for closing; closing with an uncounted line refused; recording moving the version 1 → 2; a
stale `expectedVersion` refused; closing adjusting 1 line with net variance −1500; a second close
refused; one balanced 1500/1500 `inventory_count` journal; and the balance ending at the counted
quantity of 2.

Focused suites: contracts 23/23, database 75/75, api 102/102, tenant-web 73/73 (23 warehouse tests,
including opening with a declared currency, recording seeded from system quantity, closing through
the finance route, and no recording form once closed). Build and all static gates pass.

## Stock reservations and material consumption — 2026-09-05

Bulk stock could be received, moved and adjusted, but nothing could hold quantity for a job or
record that a technician used it. `operations_stock_balances` already carried a `quantity_reserved`
column enforced against `quantity_on_hand`; migration `202609051100_tenant_stock_reservations.sql`
is what finally sets it, through `operations_stock_reservations` with its own lifecycle and
`execute_stock_reservation_command` at `POST …/warehouse/stock/reservations`
(`tenant.installation.manage` + `tenant.warehouse.stock.reserve`).

A release returns quantity to free stock and posts nothing, because nothing was used. **Consumption
is where inventory becomes cost**: it removes the used quantity and posts its value from Inventory
to Network Operating Expense (`5000`). Consuming part of a hold releases the whole hold and removes
only what was used, so an unused remainder returns to free stock instead of staying reserved.

Live acceptance on PostgreSQL 18 proves: a hold moving reserved 0 → 4 while on hand stays 6; exact
idempotent replay and changed-payload conflict; **a transfer of reserved stock refused**; a second
hold refused because only 2 of 6 were free; a serialized item refused from bulk reservation; a
transfer signature refused for a reservation; release returning reserved to 4 without any journal; a
stale expectedVersion refused; consumption above the held quantity refused; consuming 3 of a 4-unit
hold leaving reserved 0 and on hand 3; and one balanced 4500/4500 consumption journal whose debit
lands on account `5000`.

Focused suites: contracts 23/23, database 75/75, api 101/101, tenant-web 69/69 (19 warehouse tests,
including holding stock for a job, consuming and releasing with the reviewed version, and no action
offered on a closed reservation). Build and all static gates pass.

Not done: stock counts, RMA/repair lifecycle, reorder suggestions, vendor quote comparison,
backorders and damaged quantities, and weighted-average costing.

## Production checkpoint deployed — 2026-09-05 (`a0ce440`)

Production moved from `6f289f9` to `a0ce440`, promoting bulk stock, partial receiving, transfers and
adjustments. Release id `20260905T121757Z-a0ce440`. **The deploy script completed end to end with
exit code 0**, exercising the phases the previous run aborted before.

| Item                | Result                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Artifact            | sha256 `24848a45d962539bad8b0a0b20700831098f3c866d695ff4a5fd4270f4d3b1c1`, identical local and on-host |
| Backup              | `/opt/orvex-backups/20260905T121757Z-a0ce440`, verified with `sha256sum -c`                            |
| Migration reconcile | 12 already-applied files preserved byte-for-byte; 1 forward migration identified                       |
| Preflight           | control 13/13 matched; tenant 49/49 matched, 1 pending — no blocking findings                          |
| Migrations promoted | `202609051000_tenant_stock_movements.sql`; tenant ledger 49 → 50                                       |
| Services            | all five `running (healthy)`                                                                           |
| Endpoints           | `/ready` 200 after 10s, `/` 200, `/control/` 200                                                       |
| Invariants          | unbalanced journal entries 0, invalid indexes 0                                                        |
| Migration bytes     | 12 CRLF preserved, 49 LF, new migration 0 CR bytes                                                     |
| Logs                | no error/fatal/panic lines after deployment                                                            |

The proxy-settling fix proved itself: `/ready` returned non-200 for 10s after the web container was
recreated and the retry loop absorbed it, where the previous run aborted on exactly that transient.
The migration-preservation design also proved itself on a real second pass — the 12 CRLF files
inherited from 2026-09-04 were kept, and only the genuinely new migration was promoted.

Rollback boundary: `/opt/orvex-backups/20260905T121757Z-a0ce440/source.tar` plus both database
dumps. Backups retained; only the Docker build cache was pruned.

## Bulk stock, partial receiving, transfers and adjustments — 2026-09-05

The catalog could already describe a non-serialized SKU, but nothing could hold, receive, move or
count quantity, so a bulk item was a dead end. Migration `202609051000_tenant_stock_movements.sql`
adds `operations_stock_balances` (quantity per item, warehouse and bin, with `NULLS NOT DISTINCT` so
unbinned stock collapses to one row), the append-only `operations_stock_movements` ledger,
`apply_stock_delta`, `post_inventory_journal` and `execute_stock_command`. It also replaces
`execute_procurement_command` — migration 1811 is applied and untouched — so a purchase order can
carry bulk lines and be received in instalments.

Authority is split by financial consequence. A transfer relocates quantity without changing value
and posts no journal, signed with `tenant.installation.manage` + `tenant.warehouse.stock.transfer`
at `POST …/warehouse/stock/transfer`. An adjustment changes what the business owns and posts to
inventory variance (account `5200`), so it needs `tenant.accounting.post` +
`tenant.warehouse.stock.adjust` and recent MFA at `POST …/warehouse/stock/adjust`. Each route
refuses the other's command.

Partial receipts post **only the value actually received**, so a part-shipment never overstates
payables. Purchase orders gain a `partially_received` status, and the previous one-journal-per-order
index is replaced by one keyed on the receipt's own idempotency key.

Live acceptance on PostgreSQL 18 proves: a mixed serialized/bulk order; a bulk line refused by
serial number and a serialized line refused by quantity; over-receipt beyond the outstanding
quantity refused; a first instalment posting 6000 minor units and leaving the order
`partially_received`; exact idempotent replay; a second instalment posting 17800 and completing the
order, with two balanced journals summing to the full 23800; transfers moving 4 units and leaving
balances of 6 and 4; replay and changed-payload conflict; insufficient stock refused; a serialized
item refused from the bulk plane; the finance signature refused for a transfer; a decrease posting
3000/3000 to variance at standard cost; and append-only movements rejecting tampering.

Two defects were found by running the SQL rather than reading it. The command first wrote movement
rows and then `UPDATE`d them to store the result, which the append-only trigger correctly rejected;
ids are now chosen before insert so the stored result is final. And `inventory_catalog_scope_allows`
/ `inventory_warehouse_scope_allows` did not recognise the finance adjust action, so the adjusting
session could not read the item or warehouse it was correcting; both now permit that one action.

Focused suites: `@isp/contracts` 23/23, `@isp/database` 75/75, `@isp/api` 100/100, `@isp/tenant-web`
65/65 (15 warehouse tests, including reorder flagging, both stock routes, the identical-location
refusal and Arabic movement history). Build, `brand:check`, `db:check`, `smoke:api`,
`release:packaging` and Prettier pass. `apps/api/vitest.config.ts` raises the test timeout to 30s:
several route cases build multiple Fastify instances and were failing as timeouts under load rather
than on their assertions.

Not done: reservations against balances (the column exists and is enforced but nothing sets it),
stock counts, RMA/repair lifecycle, reorder suggestions, vendor quote comparison, backorders and
rejected/damaged quantities, and weighted-average costing — valuation is standard cost today.

## Production checkpoint deployed — 2026-09-05 (`6f289f9`)

Production was moved from `7ecf011` to `6f289f9`, promoting the Wave 0 release-packaging work and
the Wave 1 warehouse administration vertical. Release id `20260905T015202Z-6f289f9`.

**The preflight caught a real pre-existing corruption before anything was touched.** Run read-only
against the live tenant ledger, it reported 12 blocking `checksum_mismatch` findings: migrations
`202609021800`–`202609021811` were applied on 2026-09-04 from a CRLF checkout, so
`_orvex_migrations` holds CRLF checksums while the repository is now LF-normalized. On-disk
inspection confirmed exactly those 12 files were CRLF on the server and hashed to the recorded
values (for example `202609021811` → `bcb55006…` on disk and in the ledger, versus `c82b4e93…`
committed). Production was self-consistent, but unpacking the LF versions over them would have
aborted the migrator _after_ services were stopped — the same failure as 2026-09-04.

Resolution followed the standing rule that applied migrations are immutable including the bytes that
were applied: the deploy script now preserves the live file for every name already in the ledger and
unpacks only new forward migrations. No stored checksum was edited.

Deployment facts:

| Item                | Result                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Artifact            | `6f289f9….tar`, sha256 `74625f0e86c5d757bf458f8efff8d0156f93a8c23215ed721f7dc0fb68de5589`, identical local and on-host |
| Backup              | `/opt/orvex-backups/20260905T015202Z-6f289f9`, 7 files, `sha256sum -c` all OK                                          |
| Migrations promoted | 1 — `202609050900_tenant_warehouse_administration.sql`; tenant ledger 48 → 49, control 13 unchanged                    |
| Applied bytes kept  | 12 CRLF files preserved exactly; new migration written LF (0 CR bytes)                                                 |
| Services            | api, finance-audit-relay, network-worker, postgres, web — all `running (healthy)`                                      |
| Endpoints           | `/` 200, `/control/` 200, `/ready` 200 `{"status":"ready"}`                                                            |
| Invariants          | unbalanced journal entries 0, invalid indexes 0                                                                        |
| New schema          | `operations_warehouse_bins` and `operations_warehouse_admin_events` present                                            |
| Logs                | no error/fatal/panic lines in api, workers, or web since deployment                                                    |

Rollback boundary: `/opt/orvex-backups/20260905T015202Z-6f289f9/source.tar` plus
`orvex_control.dump` and `orvex_tenant.dump`. The backup is retained; only the Docker build cache
was pruned. No unrelated host workload was inspected or changed.

Two script defects surfaced during the run and are fixed:

- PHASE 9 aborted on a transient `502` because the reverse proxy had not yet re-registered the
  just-recreated web container. All mutating phases had already succeeded and production was healthy
  seconds later; verification now polls each endpoint until it settles (120s budget).
- The status capture combined `curl -f` with an `|| echo 000` fallback, so an error status printed
  as `502000`. `-f` is now omitted and the code captured cleanly.

Because of the first defect the script exited before its own PHASE 9/10 checks, so container state,
database invariants, schema objects, logs and backup verification were confirmed by separate
read-only commands rather than by the script itself. A subsequent deployment will exercise the fixed
path end to end.

## Release packaging hardening — 2026-09-05

The 2026-09-04 production deployment failed after services were stopped, because the release
artifact carried CRLF line endings and non-executable shell scripts. Migration checksums are SHA-256
over raw bytes, so content-identical files aborted the migrator, and
`infra/docker/postgres/admin/*.sh` could not execute in Alpine. Recovery required restoring the
server's backed-up historical migration bytes and re-installing the admin scripts with LF endings
and mode `0755`.

Four controls are now in place, with local evidence:

| Control                                           | Evidence                                                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitattributes` LF normalization                 | Staging a CRLF `.sql` file produced an LF index blob (`A \n B \n`); CRLF can no longer enter the index.                                                                                                         |
| `npm run release:packaging`                       | Passes on 597 tracked files / 60 migrations. Negative run correctly reported all 6 non-executable `*.sh` before the fix.                                                                                        |
| Six `*.sh` promoted to mode `100755` in the index | `git ls-files -s '*.sh'` shows `100755` for all 7; blob SHAs unchanged, so file content was preserved exactly.                                                                                                  |
| Migration checksum preflight                      | 7/7 unit tests: matched ledger, forward-only promotion, CRLF checksum mismatch, dropped migration, out-of-order, empty DB.                                                                                      |
| `git archive` release artifact                    | Built twice from the same commit on Windows: byte-identical tarballs. Extracted `*.sh` are mode `rwxr-xr-x`, migrations LF-only, and all 61 manifest migration checksums equal the migrator's own hashing path. |

These controls have now been exercised against production. The preflight ran read-only against the
live `_orvex_migrations` ledger, found 12 genuine checksum mismatches inherited from 2026-09-04, and
the artifact-based deploy script promoted `6f289f9` without touching a single applied migration —
see the deployment record above. Platform operations remains `partial` until restore, rollback, load
and DR exercises are recorded; one successful checkpoint is not release acceptance.

## Warehouse master-data administration — 2026-09-05

Until this checkpoint an ISP could receive stock but could not create the SKU, warehouse or bin it
was received into; those rows required a direct DBA insert. Migration
`202609050900_tenant_warehouse_administration.sql` adds versioned catalog items, warehouses and
bins, an append-only `operations_warehouse_admin_events` ledger, and
`execute_warehouse_admin_command`, reached through
`POST /v1/tenants/:tenantId/operations/warehouse/administration` and a bilingual tabbed
administration panel in the tenant warehouse workspace.

Administration carries its own signed action (`tenant.warehouse.administration.manage` under
`tenant.catalog.manage`), so a procurement signature cannot reshape the catalog. Updates are full
replacements guarded by `expectedVersion`.

Live acceptance against PostgreSQL 18 (disposable local `isp_test`) proves: allowed operation; wrong
signed action denied; exact idempotent replay returning the original result; changed-payload retry
conflict; duplicate SKU and duplicate bin code refused; stale `expectedVersion` conflict;
serialization immutable once stock or purchase commitments exist; branch outside signed scope
denied; primary-warehouse designation refused for a branch-scoped signature; warehouse holding
custody refused for closure; administration events reject tampering; and audit-outbox rows equal
administration events one-for-one.

Focused suites: `@isp/contracts` 23/23, `@isp/database` 75/75, `@isp/api` 98/98 (including a new
route test proving the distinct signed action and contract rejection), `@isp/tenant-web` 60/60
(including 10 warehouse tests covering create, versioned edit, server-conflict surfacing, trim-aware
evidence rejection, out-of-scope branch guidance, and Arabic bins/history). Repository build,
`brand:check`, `db:check`, `smoke:api`, `release:packaging` and Prettier all pass.

**Wave 0 tooling exercised for the first time against a live ledger in this checkpoint.** The
migration preflight initially failed with `permission denied for schema public` because it read the
ledger without assuming `orvex_owner` the way the migrator does; that defect is fixed. It then
reported `checksum-matched 49, pending 0` on a clean database, and correctly **blocked** a
deliberately CRLF-converted historical migration with
`BLOCKING checksum_mismatch ... applied b812d19f…, packaged c41172f6…` and exit code 1 — the exact
failure that stopped the 2026-09-04 production deployment, now caught before any container is
recreated.

Integration suite status on a clean local stack (PostgreSQL 18, Redis, MinIO): 13 of 14 live scripts
pass — finance audit upgrade, empty-migration safety, finance, finance outbox, tenant staff,
operations, invoice archive, sales, financial-source journals, inventory (including the new
administration vertical), operations relay, Collect, and the Network Worker store.

Two **pre-existing** fixture-ordering defects in the suite were identified; neither involves the
warehouse change, whose migration adds only warehouse tables and functions:

- `test-live-customer-accounts.ts` asserts "need an unpaid synthetic sales invoice", but
  `test-live-financial-journals.ts` runs before it in the `test:integration` chain and allocates
  payment to that invoice. Re-seeding `test-live-sales.ts` immediately before it makes both pass.
- `test-live-noc.ts:33` requires an invoiced service whose status is not `terminated`, while
  `test-live-sales.ts:1107` deliberately terminates its own service as part of the lifecycle
  assertions. On a genuinely clean database the NOC script can therefore never find its fixture.

`.github/workflows/ci.yml` was also missing `TENANT_STAFF_TEST_*`, `SALES_TEST_*` and
`SALES_TEST_NETWORK_WORKER_DATABASE_URL`, so the CI integration job could not have reached those
scripts; the workflow now exports them. The two fixture-ordering defects remain open and are owned
by the sales/NOC verticals, not this checkpoint.

Not done: partial and non-serialized receipts, bin-level stock balances, reservations, transfers,
stock counts, RMA/repair lifecycle, reorder suggestions, and independent review. No production
change was made; production remains on `7ecf011`.

## Accounting integrity checkpoint — 2026-09-02

Accounting is **partial**, not a completed enterprise suite. Customer credits/deposits now post
atomic, balanced, currency-correct immutable journals from persisted records; statements, trial
cutoffs and accounting read APIs are repaired; the UI no longer invents sample balances. Focused
local PostgreSQL, API/UI and contract evidence is recorded in
[the accounting integrity handoff](testing/accounting-integrity-2026-09-02.md).

New financial-source journals, explicit clearing classification, all-writer source-date guards and
manual/close/statement forms now have focused local evidence in
[the financial-source handoff](testing/financial-source-journals-2026-09-02.md). Legacy
reconciliation, independent review and production acceptance remain required. Serialized warehouse
custody and controlled procurement now have focused local verticals; non-serialized stock, real
RADIUS execution and a delivered Android artifact are separate unfinished work. The manual NOC
incident vertical and RouterOS safety corrections have focused local evidence in
[the NOC/network checkpoint](testing/noc-network-safety-2026-09-02.md), but telemetry, alarm
correlation and provider acceptance remain unfinished. No production changes were made in this
checkpoint.

## Latest bounded checkpoint - invoice documents (2026-09-02)

Tax treatment, deterministic bilingual legal-snapshot PDFs, a scoped archive/retry/download UI, and
private S3 Object Lock integration are implemented. PostgreSQL proves archive identity, idempotency,
scoped denial, append-only transitions and atomic audit. Local PDF render inspection and focused
API/UI checks support this slice; it remains `partial` at enterprise level. Production object
storage, real-provider retention/restore acceptance, independent review and bulk scheduling are
outstanding. See [activation and rollback](operations/invoice-document-archive.md). The production
host was not modified.

## Capability ledger

| Capability                           | State                             | B/F                                                                                                                                                                                                                                                                                                                                               | P/DB                                                                                                                                                                                                       | Audit/worker                                                                                                                            | Tests and acceptance                                                                                                                                  | Production dependency / next proof                                                                                                   |
| ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Organization and IAM                 | `partial`                         | Real staff directory, canonical roles, governed scopes, guarded invitations, role/scope editing, suspension, MFA step-up, staff device sessions and administrator recovery                                                                                                                                                                        | `tenant.user.administer`; recent MFA; signed Operations scope lookup; users, memberships, sessions and guarded invitation/session functions                                                                | Directory, lifecycle, session and recovery events; membership changes revoke tenant sessions                                            | Focused API/UI/a11y/type/build plus fresh PostgreSQL 18 lifecycle and staff-session proof                                                             | Activate and accept production OTP, invitation and recovery delivery; complete collector hardware acceptance                         |
| CRM and sales                        | `partial`                         | Real bilingual lead pipeline, versioned quotes, discount approval, acceptance and billed-order handoff                                                                                                                                                                                                                                            | Focused sales/catalogue/order permissions; guarded lead, qualification, quote and order schema                                                                                                             | Atomic mutation and workspace-read Operations audit                                                                                     | API/UI/a11y/build plus fresh PostgreSQL 18 lead-to-activated-and-billed-order proof                                                                   | Add campaign/site-visit/contract depth and controlled fallout/change workflows                                                       |
| Product and offer catalogue          | `partial`                         | Effective-dated immutable offer, plan and purchasable add-on/top-up versions; bilingual publication and Subscriber 360 purchase workflows                                                                                                                                                                                                         | Focused catalogue/subscriber/invoice authority; guarded versions enforce dates, currency, quota and exact replay                                                                                           | Atomic offer/plan/add-on publication and purchase audit                                                                                 | UI/API/static migration plus clean PostgreSQL 18 add-on purchase and rated-service proof                                                              | Add tax eligibility, commitments, equipment/activation fees and explicit offer-to-plan reconciliation                                |
| Address and qualification            | `partial`                         | Explainable qualification records use governed scope, technology and evidence; eligible accepted orders can consume matching declared capacity                                                                                                                                                                                                    | Sales/network permissions; immutable qualification versions; governed hierarchy and capacity constraints                                                                                                   | Atomic qualification and resource audit                                                                                                 | UI/API/live qualification, scope and capacity-reservation proof                                                                                       | Add geocode/exchange/building depth and survey artifact storage                                                                      |
| Subscriber and party management      | `partial`                         | Governed creation plus real bilingual internal search, scoped directory and Subscriber 360 identity/contact/location detail; no subscriber login                                                                                                                                                                                                  | Subscriber view/create plus order authority; hierarchy-aware FORCE-RLS scope policies; subscriber/household/location/contact schema                                                                        | Atomic Operations, sales-order and workspace-read audit                                                                                 | API/UI/a11y/build plus clean PostgreSQL 18 conversion and composed Subscriber 360 proof                                                               | Import/archive/privacy/contact-edit and duplicate-resolution workflows                                                               |
| Order orchestration                  | `partial`                         | Six-task accepted-order path closes through first billing; governed service changes now provide the post-subscriber termination path                                                                                                                                                                                                              | Order/network/installation/billing separation; FORCE-RLS dependency, command and service-change history, cancellation and idempotency guards                                                               | Atomic acceptance/execution/change/finance audit; worker and invoice results synchronize state                                          | Clean PostgreSQL 18 proves fallout recovery, exact replay, billed closure and post-subscriber termination                                             | Add relocation, appointment and multi-resource technical change orders                                                               |
| Service inventory                    | `partial`                         | Subscriber 360 reconciles current service and full plan-change, suspend, restore and terminate history through one guided bilingual workflow                                                                                                                                                                                                      | Subscriber edit + order authority; scoped service/plan/history FORCE-RLS; append-only changes; atomic network outbox and subscriber state                                                                  | Every service, subscriber, change-order and router-job mutation shares the signed audit context                                         | Fresh PostgreSQL 18 proves plan upgrade replay plus active→suspended→active→terminated and subscriber closure                                         | Add relocation, access-circuit/IP/CPE bindings and richer service dependency history                                                 |
| Resource and outside-plant inventory | `partial`                         | Bilingual scoped capacity register covers POPs, OLTs, fiber ports, wireless sectors, access nodes and capacity pools                                                                                                                                                                                                                              | `tenant.network.job.create`; FORCE-RLS resource/reservation tables, hierarchy validation and capacity constraints                                                                                          | Atomic create/reserve audit                                                                                                             | API/UI/static plus clean PostgreSQL 18 eligibility, decrement and exact-replay proof                                                                  | Expand to racks/devices/links/fiber/VLAN topology, lifecycle and attachments                                                         |
| Warehouse and procurement            | `partial`                         | Responsive bilingual workspace drives custody plus vendor registration, valued PO lines, finance approval and complete serialized receiving                                                                                                                                                                                                       | Separate catalog/finance permissions; recent MFA approval; FORCE-RLS; optimistic versions; append-only bilingual evidence; exact retry keys                                                                | Atomic procurement/custody events, Operations audit outbox, and balanced Inventory/AP journal                                           | API/UI/static plus fresh PostgreSQL 18 proof of approval, full serial receipt, retry/conflict and accounting balance                                  | SKU/warehouse administration, quote comparison, partial/non-serialized receipts, reservations, bins and transfers                    |
| Installation and field service       | `partial`                         | Dispatch board with technician registry (skills, territories), work orders with appointment windows, SLA, checklists, outcomes, failure/revisit; installation work orders drive the installation lifecycle                                                                                                                                        | Installation view/manage split into signed dispatch and execute actions; assigned-technician or tenant-wide execution; versioned records                                                                   | Append-only work order events plus operations audit outbox                                                                              | API/UI/static plus PostgreSQL 18 dispatch-to-completion, revisit and scope proof (test-live-field-service.ts)                                         | Offline technician app, materials/stock consumption on completion, photo capture, customer signature                                 |
| AAA and access control               | `partial`                         | NAS registry, RADIUS session ledger fed by worker-only accounting ingest (start/interim/stop), live sessions per NAS, service bindings with PPP account/profile; Orvex still is not the RADIUS server itself                                                                                                                                      | `tenant.network.bulk.approve` + recent MFA for infrastructure, job authority for resources; worker identity policies on NAS/session rows; secret references only                                           | Append-only network events plus audit outbox; worker-only accounting function                                                           | Live PostgreSQL 18 accounting, unregistered-NAS and non-worker refusals, API/UI proofs (test-live-network-resources.ts)                               | Redundant RADIUS service, acknowledged CoA/disconnect, real NAS acceptance (`activation_required`)                                   |
| IPAM and network configuration       | `partial`                         | Purpose-typed IPv4/IPv6 pools with utilisation, reservations, next-free allocation to a service, release, router registry, service bindings, worker job queue with cancel and evidence-backed re-queue                                                                                                                                            | Network permissions split into signed infrastructure and resource actions; FORCE-RLS pools/allocations; one live row per address; optimistic versions                                                      | Append-only events; RouterOS worker attempts preserved across re-queue                                                                  | Live PostgreSQL 18 pool/allocation/binding/job proof plus API/UI evidence                                                                             | VLAN/prefix planning, DNS records, configuration templates and change plans with rollback; RouterOS credentials/hardware             |
| CPE lifecycle                        | `foundation`                      | CPE registry (serial, model, OUI, TR-069 id, service and asset link, status, last inform) with register/update in the Network workspace                                                                                                                                                                                                           | `tenant.network.resource.manage`; FORCE-RLS; versioned records                                                                                                                                             | Append-only network events                                                                                                              | Live PostgreSQL 18 register/update proof plus UI evidence                                                                                             | Provisioning, diagnostics, firmware rollout and a TR-069/USP adapter; ACS/hardware activation                                        |
| NOC and service assurance            | `partial`                         | Alarms derived from real RouterOS worker outcomes (deduplicated, escalated, auto-cleared), operator alarms with acknowledge/clear/link, maintenance windows that mark alarms as expected, incident SLA targets and breach flags, bilingual incident queue/detail with service impact and RCA; no device polling                                   | Signed network permission, route/service scope, worker-identity policies for alarm reflection, FORCE-RLS alarms/windows/events with optimistic versions                                                    | Append-only NOC event ledger plus Operations audit; worker-only alarm trigger                                                           | Live PostgreSQL 18 worker-outcome-to-alarm, suppression, lifecycle, SLA, scope and immutability proof (test-live-noc-telemetry.ts); API and UI suites | SNMP/streaming telemetry, topology, correlation across devices, customer communications, real alarm acceptance on production routers |
| Capacity and upstream management     | `missing`                         | No upstream/capacity domain                                                                                                                                                                                                                                                                                                                       | Absent                                                                                                                                                                                                     | None                                                                                                                                    | None                                                                                                                                                  | Ogero/transit/peering commitments, utilization, cost, renewal and forecast                                                           |
| Billing and rating                   | `partial`                         | Append-only usage/top-ups and daily proration/overage/FUP rating feed immutable invoice preparations; recoverable recurring runs retain per-service outcomes; versioned legal and dunning policies drive bilingual operator workspaces                                                                                                            | Billing/invoice/subscriber permissions; guarded usage/add-on/policy/run/dunning records and immutable legal snapshots                                                                                      | Atomic usage/purchase/rating/policy/recovery/dunning audit plus Finance audit outbox/relay                                              | Clean PostgreSQL 18 proves exact rating, legal totals, partial-run recovery, failed-only retry and governed suspension review                         | Activate private archive storage; finish refund/statement scope and scheduler activation                                             |
| Accounting and treasury              | `partial`                         | Real accounting reads/forms; governed source and customer-entry journals; explicit clearing classification                                                                                                                                                                                                                                        | Signed scope, tenant FKs, immutable records and per-currency guards                                                                                                                                        | Atomic journal/close audit                                                                                                              | Focused PostgreSQL/API/UI/contracts; see latest checkpoint                                                                                            | Legacy reconciliation, complete chart/journal workflows, AR/AP/treasury and independent review                                       |
| Revenue assurance and fraud          | `partial`                         | Eight deterministic leakage controls (billed-vs-active, billed after termination, overdue invoices, unallocated and duplicate payments, pending voucher credits, collector variance, dealer over limit) with persistent findings, exposure per currency and exposure cases with ownership, lifecycle and closure evidence                         | `tenant.collection.reconcile` for runs and cases, `tenant.billing.view` to read; branch scope on findings; FORCE-RLS; optimistic versions                                                                  | Append-only assurance event ledger and Operations audit; controls never post money                                                      | Live PostgreSQL 18 control/finding lifecycle/case/scope/immutability proof (test-live-assurance.ts); API and UI suites                                | Scheduled runs, usage-vs-rating and unauthorized-service controls, management reporting export                                       |
| Payments and cash channels           | `partial` / `activation_required` | Office cashier with drawers per cashier and currency, receipts posted atomically with allocations (chosen invoice or oldest first, remainder as credit), receipt numbers from a tenant counter or a pre-printed book, method and reference kept, voids as linked reversals with reason; provider settlement adapters incomplete                   | `tenant.payment.post` to post, `tenant.payment.reverse` + recent MFA to void, `tenant.payment.view` to read; branch scope on drawers, subscriber scope on receipts; immutable payments/allocations         | Finance relay, Operations audit on drawers and receipts, append-only cashier event ledger                                               | Live PostgreSQL 18 drawer/receipt/void/scope/replay proof (test-live-cashier-collections.ts); API and UI suites                                       | POS/bank/OMT/Whish/LibanPost/Cash United adapters, contracts, credentials and settlement acceptance                                  |
| Dealer/reseller and vouchers         | `partial`                         | Dealer registry (type, branch, credit limits, commission, status), per-currency float ledger, PIN batches generated in the database with one-time PIN exposure, issue net of commission, cancellation refunds, guarded redemption with lockout and a visible subscriber-credit saga                                                               | `tenant.payment.post` for the channel, `tenant.collection.reconcile` + recent MFA for adjustments, `tenant.payment.view` to read; branch scope on dealers; FORCE-RLS; column-list grants hide PIN material | Append-only float and event ledgers (PINs never stored), Operations audit, customer account deposit through the finance ledger          | Live PostgreSQL 18 registry/float/batch/redemption/saga/scope/immutability proof (test-live-dealers.ts); API and UI suites                            | Dealer hierarchy and POS users, dealer settlement statements, voucher printing templates, fraud analytics                            |
| Collections                          | `partial` / `activation_required` | Default collector per route, assignments derived from the open balance (single or every due invoice on a route), visit/return/cancel/reassign outcomes, office-recorded collections with real amounts, route settlements with a kept difference approved by a second manager, Collect device submissions in the same list, device sync visibility | `tenant.collection.reconcile` to manage and approve (recent MFA), `tenant.payment.post` to record cash, `tenant.collection.view` to read; route scope                                                      | Operations audit on assignments, evidence, route collectors and settlements; append-only collection event ledger; Collect sync evidence | Live PostgreSQL 18 assignment/collection/settlement/approval/scope proof (test-live-cashier-collections.ts); Collect offline/idempotency/device tests | Production collector account, OTP, approved printer and end-of-day acceptance with real hardware                                     |
| Customer service and complaints      | `partial`                         | Ticket workspace with intake channel, caller verification, category, priority SLA targets and breach badges, notes and first response, escalation, incident link, governed status changes, reopen and redress                                                                                                                                     | `tenant.subscriber.edit` for ticket work, `tenant.subscriber.view` to read; subscriber scope; FORCE-RLS notes/events; optimistic versions                                                                  | Append-only notes, support and issue event ledgers plus Operations audit                                                                | Live PostgreSQL 18 intake/SLA/escalation/transition/reopen/redress/scope proof (test-live-customer-service.ts); API and UI suites                     | Omnichannel intake adapters, knowledge base, customer-facing status, satisfaction survey                                             |
| Communications                       | `partial`                         | Bilingual templates with separated approval, per-channel subscriber consent, notification outbox with rendering, destination resolution, suppression reasons, retry and delivery evidence; product-managed SMTP/SMS/WhatsApp providers                                                                                                            | Template governance `tenant.user.administer`; messaging `tenant.subscriber.edit`; delivery `tenant.secret.manage`; masked destinations for readers                                                         | Append-only consent and communication event ledgers plus Operations audit; delivery recorded per attempt with deterministic keys        | Live PostgreSQL 18 template/consent/queue/delivery proof; API and UI suites; providers remain `activation_required` until credentials are configured  | Scheduled delivery worker, provider receipts/webhooks, event-driven billing and outage notifications                                 |
| Documents and verification           | `partial`                         | Deterministic bilingual posted-invoice PDFs, private archive/retry/download UI; secure verifier boundary specified                                                                                                                                                                                                                                | Invoice authority; signed scoped FORCE-RLS archive metadata; retained private S3 objects                                                                                                                   | Atomic archive mutation and download audit; retained create-only S3 objects                                                             | Live posted-invoice archive metadata and focused renderer/API/UI proof; no public verifier E2E                                                        | Activate Object Lock storage/restore; uploads/quarantine/scanning, legal hold/disposal and opaque verifier                           |
| Regulatory and QoS                   | `missing`                         | No obligations/KPI/reporting workspace                                                                                                                                                                                                                                                                                                            | Absent                                                                                                                                                                                                     | None                                                                                                                                    | None                                                                                                                                                  | TRA/license/tariff/QoS evidence model and reproducible submissions                                                                   |
| Management analytics                 | `partial`                         | Live operations dashboard computed from real records (collections by channel, receivables, sessions, failed work, audited activity) and nine governed report datasets with CSV export recorded as evidence; no demonstration figures anywhere in the tenant shell                                                                                 | `tenant.dashboard.view`, `tenant.report.view`, `tenant.report.export`; signed read contexts and row policies apply scope; currencies never combined                                                        | Export jobs audited through the operations outbox                                                                                       | Live PostgreSQL 18 dashboard/report/export proof (test-live-analytics.ts); API and UI suites                                                          | Scheduled report delivery, executive trend history, churn and capacity analytics, PDF/XLSX rendering                                 |
| People operations                    | `missing`                         | IAM identity is not an HR/people operations workflow                                                                                                                                                                                                                                                                                              | Absent                                                                                                                                                                                                     | None                                                                                                                                    | None                                                                                                                                                  | Teams/skills/schedules/leave/training/access-lifecycle without surveillance                                                          |
| Security and audit                   | `foundation`                      | Canonical sessions, MFA boundary, scoped grants, tenant auth, staff device administration and immutable evidence exist                                                                                                                                                                                                                            | Central permission catalogue, recent-MFA guards, FORCE RLS and guarded roles/functions                                                                                                                     | Security/control/tenant audit planes                                                                                                    | Deny/isolation/session tests and fresh staff lifecycle proof exist; full DAST review absent                                                           | Complete secure uploads/webhooks, DAST and incident acceptance                                                                       |
| Integration and data management      | `partial`                         | Versioned API, idempotent operations and provider interfaces exist; lineage/import/webhooks incomplete                                                                                                                                                                                                                                            | Route permissions and guarded worker DB roles                                                                                                                                                              | Outbox/inbox patterns in implemented slices                                                                                             | Finance/network/collect replay tests                                                                                                                  | Mapping/validation, durable webhooks, retention/legal hold, import/export and recovery                                               |
| Platform operations                  | `partial`                         | Control Center, deployment profiles, health/readiness, backup/rollback kit exist                                                                                                                                                                                                                                                                  | Platform permissions; control clients/subscriptions/deployments/grants                                                                                                                                     | Control audit and observability contracts                                                                                               | Prior release/static/live foundation evidence; production-volume restore/DAST not current                                                             | Tenant exit/export, entitlement UI completeness, independent restore, rollback, load and alert drills                                |
| Orvex management console             | `partial`                         | Control Center client/subscription/finance/deployment/support vertical exists; authenticated API client and full entitlement UI incomplete                                                                                                                                                                                                        | Platform permissions; migration 2100                                                                                                                                                                       | Atomic control audit and approved support grants                                                                                        | Control API/repository/live DB foundation evidence                                                                                                    | Real authenticated list/detail/admin UI, feature entitlements, lifecycle and support-session E2E                                     |
| LearnISP                             | `missing`                         | No `/learnisp` application or generated reference                                                                                                                                                                                                                                                                                                 | Public docs only; no runtime authorization required                                                                                                                                                        | Build/link evidence absent                                                                                                              | None                                                                                                                                                  | Build only from implemented behavior after each wave; bilingual search/RTL/direct-route/E2E                                          |

## Wave 1 active acceptance ledger

| Requirement                              | Backend                                                                   | Frontend                                                           | Permission / scope                                                            | Database / migration                                            | Audit                                                                                              | E2E / failure / UI evidence                                                                | State                             |
| ---------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| Staff directory                          | `GET /v1/tenants/:tenantId/staff`                                         | Bilingual responsive list, search, role filter and posture metrics | `tenant.user.administer`; verified tenant context                             | `users`, `tenant_memberships`                                   | allow/deny/failed read events                                                                      | API allow/deny, UI loading/error/filter/a11y, production builds                            | `partial`                         |
| Canonical role catalogue                 | Canonical least-privilege API catalogue                                   | Bilingual role labels and preset selectors                         | Central permission catalogue and MFA/scope modes                              | No preset persistence required                                  | Catalogue read audited                                                                             | Contract and UI evidence; live composed proof pending                                      | `partial`                         |
| Secure invitation/onboarding             | Opaque HMAC token, one-time acceptance, explicit revoke and delivery port | Invitation, history/revoke and public bilingual acceptance view    | Admin + recent MFA; active Operations route validation; support grants denied | Guarded FORCE-RLS invitation table/functions; token digest only | Immutable create/accept/revoke                                                                     | API/service/UI plus fresh PostgreSQL 18 MFA/replay/revoke/RLS proof pass; provider pending | `partial` / `activation_required` |
| Staff detail and scope assignment        | Canonical membership mutation                                             | Inline role/scope editor using active governed routes              | Recent MFA, role presets, tenant scope, support denial                        | `tenant_memberships.scope`; auth version increments             | Before/after update evidence                                                                       | Focused UI/service plus live version/scope proof pass                                      | `partial`                         |
| Suspend/reactivate and auth invalidation | Guarded membership update and last-owner/self protections                 | Suspend/restore actions                                            | Admin + recent MFA                                                            | Membership active/version; matching tenant sessions revoked     | Before/after lifecycle event                                                                       | Live self/last-owner denial and session invalidation proof pass                            | `partial`                         |
| Session/device administration            | Governed staff session list and targeted revoke API                       | Bilingual session/device panel with active/current/revoked states  | Administrator + recent MFA; tenant membership/session checks; support denied  | Guarded control functions over `auth_sessions`; readiness gate  | API/UI/type/build plus twice-run live proof, including fresh PostgreSQL and current-session denial | `verified`                                                                                 |
| Recovery administration                  | Governed administrator recovery trigger reuses opaque recovery tokens     | Bilingual per-employee recovery action                             | Administrator + recent MFA; target tenant membership; support denied          | `auth_recovery_tokens` with idempotency                         | API denial/allow and focused service/UI/build evidence                                             | `partial` / `activation_required`                                                          |
| Collector eligibility/onboarding         | Collect device checks canonical permission + recent MFA                   | Directory shows collector count only                               | `tenant.collection.view` plus device authorization boundary                   | membership, auth session, collect devices                       | auth/collect audit                                                                                 | No production collector/OTP/printer acceptance                                             | `partial` / `activation_required` |

## Wave 2 active acceptance ledger

| Requirement                               | Composed evidence                                                                                                                       | State     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Lead and qualification (PRD-CTL-004)      | Governed create/read, immutable explainable qualification versions, scope-aware bilingual pipeline and live PostgreSQL proof            | `partial` |
| Offer and quote control (PRD-CTL-004)     | Effective immutable offer versions, quote versioning, discount approval with recent MFA, separation denial and acceptance evidence      | `partial` |
| Service-order decomposition (PRD-CTL-004) | Idempotent accepted order and six deterministic dependency tasks proven live                                                            | `partial` |
| Subscriber conversion (PRD-CTL-004)       | Exact-replay-safe atomic household/location/contact/subscriber creation, order linkage and next-task unlock proven live                 | `partial` |
| Capacity registration and reservation     | Scoped capacity register plus atomic eligible order reservation, decrement, exact replay and installation-task unlock proven live       | `partial` |
| Installation execution                    | Linked service/field work, optimistic transitions, completion evidence and network-task unlock proven live                              | `partial` |
| Verified network activation               | Order plan/profile, privileged binding prerequisite, durable activation queue, worker terminal result and billing unlock pass live      | `partial` |
| First billing and order completion        | Effective plan/policy resolution, explicit VAT/rounding, immutable invoice, billing linkage, exact replay and closed order pass live    | `partial` |
| Usage, top-up and overage rating          | Append-only usage, effective add-on purchase, quota balance, FUP decision and exact rated invoice components pass live                  | `partial` |
| Recurring recovery and governed dunning   | Durable bilingual per-service failures, exact failed-only retry and versioned overdue review pass live; no automatic network action     | `partial` |
| Order exception commands                  | Immutable hold/resume/retry/cancel command history, fallout synchronization, exact replay and side-effect cancellation guards pass live | `partial` |

## Release rule

The product may not be described as fully production-ready while any software-controlled capability
required by the controlling map is `missing` or `partial`. Deployment health of the current
foundation does not change those capability states. Each implementation commit must update this
ledger with the exact test command and composed evidence before promotion to `verified`.

## Customer account checkpoint — 2026-09-02

Unpaid-invoice credit adjustments, received deposits, same-customer/currency allocation and linked
reversals now have a signed/scoped API and bilingual Billing UI. Credits are separate from cash;
integer balances feed Subscriber 360, dunning and Collect's server calculations. Account history is
append-only with atomic audit, replay protection and concurrent-allocation guards.

Focused proof: 52 API, contract, UI/accessibility and money-parsing tests; local PostgreSQL account
script; database/API/tenant-web builds. See
[exact evidence and exclusions](testing/customer-accounts-2026-09-02.md) and
[operator/deployment runbook](operations/customer-accounts.md). Billing remains **partial**:
paid-credit carry-forward, refunds, debit notes, full statements, statutory credit PDFs and
scheduler activation are not completed. Accounting remains **partial**; the subsequent checkpoints
above supersede this earlier boundary. Independent finance review and production acceptance remain
required; this checkpoint did not change production.
