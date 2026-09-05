# Orvex ISP enterprise release status

Status: live engineering ledger Controlling specification:
[`product/enterprise-capability-map.md`](product/enterprise-capability-map.md) Updated: 2026-09-05

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

| Capability                           | State                 | B/F                                                                                                                                                                                                                                    | P/DB                                                                                                                                         | Audit/worker                                                                                    | Tests and acceptance                                                                                                          | Production dependency / next proof                                                                                |
| ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Organization and IAM                 | `partial`             | Real staff directory, canonical roles, governed scopes, guarded invitations, role/scope editing, suspension, MFA step-up, staff device sessions and administrator recovery                                                             | `tenant.user.administer`; recent MFA; signed Operations scope lookup; users, memberships, sessions and guarded invitation/session functions  | Directory, lifecycle, session and recovery events; membership changes revoke tenant sessions    | Focused API/UI/a11y/type/build plus fresh PostgreSQL 18 lifecycle and staff-session proof                                     | Activate and accept production OTP, invitation and recovery delivery; complete collector hardware acceptance      |
| CRM and sales                        | `partial`             | Real bilingual lead pipeline, versioned quotes, discount approval, acceptance and billed-order handoff                                                                                                                                 | Focused sales/catalogue/order permissions; guarded lead, qualification, quote and order schema                                               | Atomic mutation and workspace-read Operations audit                                             | API/UI/a11y/build plus fresh PostgreSQL 18 lead-to-activated-and-billed-order proof                                           | Add campaign/site-visit/contract depth and controlled fallout/change workflows                                    |
| Product and offer catalogue          | `partial`             | Effective-dated immutable offer, plan and purchasable add-on/top-up versions; bilingual publication and Subscriber 360 purchase workflows                                                                                              | Focused catalogue/subscriber/invoice authority; guarded versions enforce dates, currency, quota and exact replay                             | Atomic offer/plan/add-on publication and purchase audit                                         | UI/API/static migration plus clean PostgreSQL 18 add-on purchase and rated-service proof                                      | Add tax eligibility, commitments, equipment/activation fees and explicit offer-to-plan reconciliation             |
| Address and qualification            | `partial`             | Explainable qualification records use governed scope, technology and evidence; eligible accepted orders can consume matching declared capacity                                                                                         | Sales/network permissions; immutable qualification versions; governed hierarchy and capacity constraints                                     | Atomic qualification and resource audit                                                         | UI/API/live qualification, scope and capacity-reservation proof                                                               | Add geocode/exchange/building depth and survey artifact storage                                                   |
| Subscriber and party management      | `partial`             | Governed creation plus real bilingual internal search, scoped directory and Subscriber 360 identity/contact/location detail; no subscriber login                                                                                       | Subscriber view/create plus order authority; hierarchy-aware FORCE-RLS scope policies; subscriber/household/location/contact schema          | Atomic Operations, sales-order and workspace-read audit                                         | API/UI/a11y/build plus clean PostgreSQL 18 conversion and composed Subscriber 360 proof                                       | Import/archive/privacy/contact-edit and duplicate-resolution workflows                                            |
| Order orchestration                  | `partial`             | Six-task accepted-order path closes through first billing; governed service changes now provide the post-subscriber termination path                                                                                                   | Order/network/installation/billing separation; FORCE-RLS dependency, command and service-change history, cancellation and idempotency guards | Atomic acceptance/execution/change/finance audit; worker and invoice results synchronize state  | Clean PostgreSQL 18 proves fallout recovery, exact replay, billed closure and post-subscriber termination                     | Add relocation, appointment and multi-resource technical change orders                                            |
| Service inventory                    | `partial`             | Subscriber 360 reconciles current service and full plan-change, suspend, restore and terminate history through one guided bilingual workflow                                                                                           | Subscriber edit + order authority; scoped service/plan/history FORCE-RLS; append-only changes; atomic network outbox and subscriber state    | Every service, subscriber, change-order and router-job mutation shares the signed audit context | Fresh PostgreSQL 18 proves plan upgrade replay plus active→suspended→active→terminated and subscriber closure                 | Add relocation, access-circuit/IP/CPE bindings and richer service dependency history                              |
| Resource and outside-plant inventory | `partial`             | Bilingual scoped capacity register covers POPs, OLTs, fiber ports, wireless sectors, access nodes and capacity pools                                                                                                                   | `tenant.network.job.create`; FORCE-RLS resource/reservation tables, hierarchy validation and capacity constraints                            | Atomic create/reserve audit                                                                     | API/UI/static plus clean PostgreSQL 18 eligibility, decrement and exact-replay proof                                          | Expand to racks/devices/links/fiber/VLAN topology, lifecycle and attachments                                      |
| Warehouse and procurement            | `partial`             | Responsive bilingual workspace drives custody plus vendor registration, valued PO lines, finance approval and complete serialized receiving                                                                                            | Separate catalog/finance permissions; recent MFA approval; FORCE-RLS; optimistic versions; append-only bilingual evidence; exact retry keys  | Atomic procurement/custody events, Operations audit outbox, and balanced Inventory/AP journal   | API/UI/static plus fresh PostgreSQL 18 proof of approval, full serial receipt, retry/conflict and accounting balance          | SKU/warehouse administration, quote comparison, partial/non-serialized receipts, reservations, bins and transfers |
| Installation and field service       | `partial`             | Accepted orders create linked service/field work; bilingual scheduling, work start and evidence capture drive the guarded installation lifecycle                                                                                       | Installation + order permissions; versioned events; linked order; signal/equipment evidence guards                                           | Operations and order-task audit                                                                 | API/UI/static plus clean PostgreSQL 18 requested-to-completed transition and network-unlock proof                             | Dispatch board, offline technician, materials/stock consumption, photos and revisit workflow                      |
| AAA and access control               | `foundation`          | NAS/session/IPAM records and a RouterOS worker boundary exist, but Orvex is not a RADIUS AAA service                                                                                                                                   | Network permissions and tenant AAA/IPAM schema; DB-only disconnect now fails closed without an execution adapter                             | RouterOS worker with action-specific acknowledgement; no RADIUS CoA worker                      | 37 worker tests and safe-adapter proofs do not verify redundant AAA or a real NAS                                             | Implement redundant RADIUS, policy/accounting and acknowledged CoA/disconnect; accept real infrastructure         |
| IPAM and network configuration       | `partial`             | Router bindings/jobs, plan profile references and order-side activation exist; IPAM and change-plan UI absent                                                                                                                          | Network permissions; routers, bindings, durable jobs; worker-only terminal synchronization                                                   | Network Worker attempts/reconciliation and terminal result evidence                             | Fresh PostgreSQL 18 lead-to-verified-activation proof plus worker/API/UI/static evidence                                      | Conflict-safe pools/VLAN/IP allocation plus approved rollback-capable changes; RouterOS credentials/hardware      |
| CPE lifecycle                        | `missing`             | No provisioning/diagnostics/firmware workflow                                                                                                                                                                                          | Absent                                                                                                                                       | None                                                                                            | None                                                                                                                          | Models, firmware, provisioning and TR-069/USP adapter; ACS/hardware activation                                    |
| NOC and service assurance            | `partial`             | Real bilingual incident queue/create/detail and guarded lifecycle with service impact and RCA; health/readiness is not monitoring                                                                                                      | Signed network permission, canonical route/service scope, FORCE-RLS outage/impact/event history and optimistic version guard                 | Atomic immutable incident lifecycle and Operations audit; no telemetry ingestion                | Local PostgreSQL denial/race/replay/audit proof, 30 API tests, 5 UI tests, RTL visual QA; no real alarm E2E                   | Add discovery, telemetry, correlation, SLA/maintenance/comms and production acceptance                            |
| Capacity and upstream management     | `missing`             | No upstream/capacity domain                                                                                                                                                                                                            | Absent                                                                                                                                       | None                                                                                            | None                                                                                                                          | Ogero/transit/peering commitments, utilization, cost, renewal and forecast                                        |
| Billing and rating                   | `partial`             | Append-only usage/top-ups and daily proration/overage/FUP rating feed immutable invoice preparations; recoverable recurring runs retain per-service outcomes; versioned legal and dunning policies drive bilingual operator workspaces | Billing/invoice/subscriber permissions; guarded usage/add-on/policy/run/dunning records and immutable legal snapshots                        | Atomic usage/purchase/rating/policy/recovery/dunning audit plus Finance audit outbox/relay      | Clean PostgreSQL 18 proves exact rating, legal totals, partial-run recovery, failed-only retry and governed suspension review | Activate private archive storage; finish refund/statement scope and scheduler activation                          |
| Accounting and treasury              | `partial`             | Real accounting reads/forms; governed source and customer-entry journals; explicit clearing classification                                                                                                                             | Signed scope, tenant FKs, immutable records and per-currency guards                                                                          | Atomic journal/close audit                                                                      | Focused PostgreSQL/API/UI/contracts; see latest checkpoint                                                                    | Legacy reconciliation, complete chart/journal workflows, AR/AP/treasury and independent review                    |
| Revenue assurance and fraud          | `partial`             | Some finance/collector reconciliation constraints; no leakage case workspace                                                                                                                                                           | Finance/collection permissions; allocation/reconciliation records                                                                            | Finance and Operations audit                                                                    | Payment/collector integrity tests                                                                                             | Scheduled billed-vs-active controls, exposure cases, ownership and closure                                        |
| Payments and cash channels           | `partial`             | Idempotent office/collector payment writes exist; provider settlement adapters incomplete                                                                                                                                              | Payment permissions; immutable payments/allocations                                                                                          | Finance relay; provider worker not complete                                                     | Finance concurrency/idempotency evidence                                                                                      | POS/bank/OMT/Whish/LibanPost/Cash United adapters, contracts, credentials and settlement acceptance               |
| Dealer/reseller and vouchers         | `missing`             | No dealer/voucher workflow                                                                                                                                                                                                             | Absent                                                                                                                                       | None                                                                                            | None                                                                                                                          | Atomic dealer credit, PIN batches, top-up, commission, settlement and fraud controls                              |
| Collections                          | `partial`             | Collect mobile/backend/offline sync and reconciliation exist                                                                                                                                                                           | Collection permissions; collect device/sync/reconciliation tables                                                                            | Collect sync evidence and Operations audit                                                      | Offline/idempotency/device tests; no production collector acceptance                                                          | Staff onboarding, OTP, printer, assignments and cash-handover E2E; hardware/provider activation                   |
| Customer service and complaints      | `partial`             | Internal support mutation exists; complete ticket/complaint workspace absent                                                                                                                                                           | Support/subscriber permissions; support issues/events                                                                                        | Operations audit outbox                                                                         | State-transition foundation tests                                                                                             | Verification, SLA, outage link, escalation, redress, reopen and knowledge workflow                                |
| Communications                       | `activation_required` | Auth delivery port exists; business notification templates/worker incomplete                                                                                                                                                           | Provider secrets by environment/reference                                                                                                    | Auth delivery errors observable; no notification outbox                                         | Auth adapter tests only                                                                                                       | Complete consent/template/retry/receipt worker; SMS/email/WhatsApp contracts and credentials                      |
| Documents and verification           | `partial`             | Deterministic bilingual posted-invoice PDFs, private archive/retry/download UI; secure verifier boundary specified                                                                                                                     | Invoice authority; signed scoped FORCE-RLS archive metadata; retained private S3 objects                                                     | Atomic archive mutation and download audit; retained create-only S3 objects                     | Live posted-invoice archive metadata and focused renderer/API/UI proof; no public verifier E2E                                | Activate Object Lock storage/restore; uploads/quarantine/scanning, legal hold/disposal and opaque verifier        |
| Regulatory and QoS                   | `missing`             | No obligations/KPI/reporting workspace                                                                                                                                                                                                 | Absent                                                                                                                                       | None                                                                                            | None                                                                                                                          | TRA/license/tariff/QoS evidence model and reproducible submissions                                                |
| Management analytics                 | `partial`             | Real tenant summary plus demonstration unauthenticated catalogue; drill-down datasets incomplete                                                                                                                                       | Dashboard/report permissions; snapshots                                                                                                      | Summary read audit                                                                              | Summary API/UI tests                                                                                                          | Reconciled KPI drill-down, explicit windows/currencies and production-scale queries                               |
| People operations                    | `missing`             | IAM identity is not an HR/people operations workflow                                                                                                                                                                                   | Absent                                                                                                                                       | None                                                                                            | None                                                                                                                          | Teams/skills/schedules/leave/training/access-lifecycle without surveillance                                       |
| Security and audit                   | `foundation`          | Canonical sessions, MFA boundary, scoped grants, tenant auth, staff device administration and immutable evidence exist                                                                                                                 | Central permission catalogue, recent-MFA guards, FORCE RLS and guarded roles/functions                                                       | Security/control/tenant audit planes                                                            | Deny/isolation/session tests and fresh staff lifecycle proof exist; full DAST review absent                                   | Complete secure uploads/webhooks, DAST and incident acceptance                                                    |
| Integration and data management      | `partial`             | Versioned API, idempotent operations and provider interfaces exist; lineage/import/webhooks incomplete                                                                                                                                 | Route permissions and guarded worker DB roles                                                                                                | Outbox/inbox patterns in implemented slices                                                     | Finance/network/collect replay tests                                                                                          | Mapping/validation, durable webhooks, retention/legal hold, import/export and recovery                            |
| Platform operations                  | `partial`             | Control Center, deployment profiles, health/readiness, backup/rollback kit exist                                                                                                                                                       | Platform permissions; control clients/subscriptions/deployments/grants                                                                       | Control audit and observability contracts                                                       | Prior release/static/live foundation evidence; production-volume restore/DAST not current                                     | Tenant exit/export, entitlement UI completeness, independent restore, rollback, load and alert drills             |
| Orvex management console             | `partial`             | Control Center client/subscription/finance/deployment/support vertical exists; authenticated API client and full entitlement UI incomplete                                                                                             | Platform permissions; migration 2100                                                                                                         | Atomic control audit and approved support grants                                                | Control API/repository/live DB foundation evidence                                                                            | Real authenticated list/detail/admin UI, feature entitlements, lifecycle and support-session E2E                  |
| LearnISP                             | `missing`             | No `/learnisp` application or generated reference                                                                                                                                                                                      | Public docs only; no runtime authorization required                                                                                          | Build/link evidence absent                                                                      | None                                                                                                                          | Build only from implemented behavior after each wave; bilingual search/RTL/direct-route/E2E                       |

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
