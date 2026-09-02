# Orvex ISP continuation task plan

Status values: `Pending`, `In progress`, `Blocked`, `Verified`.

| Gate | Work                                                        | Owner                           | Dependencies      | Evidence required                            | Status      |
| ---- | ----------------------------------------------------------- | ------------------------------- | ----------------- | -------------------------------------------- | ----------- |
| A0   | Capture pre-remediation baseline and audit                  | Lead + independent audit agents | None              | Commit, commands, audit report               | Verified    |
| A1   | Controlled Orvex product identity migration                 | Brand/UX                        | A0                | Scan, focused tests/build, ADR               | Verified    |
| A2   | Runnable compiled API artifact                              | Lead                            | A0                | Ordered build and health smoke               | Verified    |
| A3   | Restricted database roles and migration hardening           | Database                        | A0                | Static checks plus live role proof           | Verified    |
| A4   | Verified tenant capability and denial-audit repair          | Lead + Database                 | A3                | API and live pool/isolation tests            | Verified    |
| A5   | Canonical sessions, permissions, and support grants         | Identity/API                    | A3, A4            | Revocation/narrowing/approval matrix         | Verified    |
| A6   | API contracts, OpenAPI, readiness, redaction                | API                             | A4, A5            | Contract and dependency-failure tests        | Verified    |
| B1   | Official-source competitive/no-copy research                | UX research                     | A0                | Reviewed research document                   | Verified    |
| B2   | Orvex tokens and component catalogue                        | Design system                   | A1, B1            | EN/AR, a11y/RTL/catalog build evidence       | Verified    |
| B3   | Secure Control and Operations reference routes              | Web                             | A5, A6, B2        | Functional and independent UX review         | Verified    |
| C    | Control Center reference domain and production composition  | Control Center team             | Phase B           | Signed approval, billing, state-relay E2E    | Verified    |
| D    | ISP Operations reference domain and production composition  | Operations team                 | Phase B           | Signed scope, concurrency, audit-relay E2E   | Verified    |
| E    | Orvex ISP Collect                                           | Mobile team                     | Phase D contracts | Offline-day fault matrix                     | Verified    |
| F    | Network Worker and provider adapters                        | Network/Integrations            | Phase D contracts | Simulator/provider contract matrix           | Verified    |
| G    | Scale, security, DR, and release candidate                  | SRE + QA + Security             | C–F               | Load, DAST, restore, rollback, final review  | In progress |
| H1   | Enterprise capability truth and tenant staff administration | Product + Identity + Web        | A5, D, E          | Capability map, staff/role/MFA/collector E2E | In progress |
| H2   | CRM, catalogue, qualification, and service orders           | Sales + Operations              | H1                | Lead-to-activated-service E2E                | In progress |
| H3   | Resource inventory, warehouse, field service, AAA and IPAM  | Network + Field + Inventory     | H2                | Order-to-resource-to-network E2E             | In progress |
| H4   | NOC, assurance, capacity, CPE, QoS and regulatory reporting | NOC + Compliance                | H3                | Alarm-to-impact-to-restoration E2E           | Pending     |
| H5   | Rating, accounting, revenue assurance, channels and dealers | Finance + Revenue               | H2, H3            | Usage-to-ledger-to-settlement E2E            | Pending     |
| H6   | Enterprise care, documents, people operations and analytics | Care + Administration           | H1–H5             | Complaint-to-close plus management close E2E | Pending     |
| H7   | Enterprise production acceptance                            | QA + Security + Owners          | H1–H6             | Scale, DAST, DR, hardware and owner approval | Pending     |

The H-series expansion is controlled by `docs/product/enterprise-capability-map.md`. Earlier
verified gates remain valid foundation evidence; they do not imply that the newly expanded
enterprise capabilities are complete.

## Historical file ownership rules

- Brand/UX: web apps, shared UI, research/UX docs, brand ADR and scan.
- Database: database package, PostgreSQL init, Compose, live-database evidence doc.
- Lead/API: API, contracts/domain, root scripts/config, audit/task documentation.
- No two owners edit the same migration or shared component simultaneously.

## Current external inputs

- VAT/numbering/retention/rounding policy, commercial catalogue, accepted RPO/RTO and off-host
  backup policy, live OMT/Whish and notification-provider contracts, RouterOS credentials/lab scope,
  and printer policy remain owner decisions. Provider and network boundaries stay fail-closed until
  those inputs are supplied and verified; they do not invalidate the completed product code.
- The production composition is active at `isp.mosesgr.com`. Final Gate G acceptance still requires
  recorded production-volume/load and DAST evidence, an isolated restore, a rollback rehearsal, and
  owner acceptance of the residual risks.

## Latest product and launch evidence

- On 2026-09-02 the posted-invoice document slice added versioned taxable/exempt/out-of-scope policy
  evidence, deterministic bilingual PDFs, durable pending/ready archive metadata and an authorized
  retry/download UI. PostgreSQL reserve/replay/finalize, conflicting checksum, branch denial,
  immutable deletion and atomic audit passed. Storage code enforces private namespaces, conditional
  writes and COMPLIANCE retention; production S3/provider/restore acceptance and independent review
  remain required. Two additive tenant migrations preserve applied history. See
  [the invoice archive runbook](operations/invoice-document-archive.md). No production change.

- On 2026-09-02 recurring billing recovery and governed dunning passed a clean PostgreSQL 18
  composed proof. A valid service retained its invoice preparation while a misconfigured service
  produced a durable bilingual `missing_plan_version` outcome; after the effective plan version was
  published, an exact retry processed only that failed service at attempt two. A versioned dunning
  policy advanced the unpaid posted invoice to `suspension_review`, replayed exactly, exposed the
  evidence in the bilingual Billing workspace, and created no network command. Focused migration,
  readiness, API, UI/accessibility, type and live database checks pass.

- On 2026-09-02 the legal-invoice tranche passed clean PostgreSQL 18 migrations and the composed
  sales proof. The accepted quote's 8% discount, branch-effective 11% VAT policy and explicit USD
  stamp duty produced exact minor-unit components: 18,000 gross, 1,440 discount, 16,560 taxable,
  1,822 VAT, 100 stamp and 18,482 total. The immutable bilingual legal snapshot carries supplier and
  recipient identities, Ministry of Finance registration, serial/date, service description, tax
  rate/amount and ten-year retention policy; Subscriber 360 renders the same source totals.

- On 2026-09-02 the focused add-on/usage rating gate passed database/API/tenant-web strict types,
  lint, production builds, migration/readiness/API/UI tests, schema safety and the live PostgreSQL
  18 sales script
  (`npm exec --workspace=@isp/database -- tsx --conditions=development scripts/test-live-sales.ts`).
  The composed proof posted an exact USD invoice with 12,500 base, 500 quota top-up, 5,000 usage
  overage and 1,980 VAT minor units; purchase and usage replays were exact and the Subscriber 360
  balance reconciled the same source records.

- H2 now has a governed first vertical from lead capture through immutable offer/qualification
  versions, controlled quote discount approval, acceptance evidence, and deterministic service-order
  decomposition. Its first dependency now atomically converts the accepted lead into governed
  household, location, contact and subscriber records, links the order, and unlocks resource
  reservation with exact idempotent replay. The bilingual Sales & Orders workspace uses real
  authorized data. Focused strict types, lint, builds, API/database/UI/accessibility tests, clean
  PostgreSQL 18 migrations, hierarchical RLS denial, approval separation and live
  lead-to-subscriber-order proof pass. Scoped capacity registration and exact-replay-safe resource
  reservation now decrements availability and unlocks installation. Linked service and field-work
  creation, scheduling, versioned progress, signal/equipment evidence, completion and network-task
  unlock now pass clean PostgreSQL 18 proof. Network-ready plan publication, durable activation,
  worker-only verified terminal synchronization and first-billing unlock now pass. Effective branch
  billing policy resolution, explicit VAT/rounding, immutable invoice posting, billing-run linkage,
  exact replay, finance/operations audit and final order closure now pass a fresh PostgreSQL 18
  composed proof. Immutable exception commands, hold/resume replay, automatic fallout, resolution
  retry and unsafe post-subscriber cancellation denial now pass live. Post-subscriber plan change,
  suspend, restore and termination now pass atomically with durable network jobs. The effective plan
  version now carries speed, quota, billing mode, proration, FUP, included add-ons and overage
  policy; the first invoice stores an exact base/add-on/overage and policy snapshot. A real
  permission-scoped, read-audited bilingual Subscriber 360 workspace now reconciles identity,
  contacts, address, services, plans, installation, activation, invoice balances and support history
  without creating subscriber authentication.
- H1 now includes a real Staff & Access Center with canonical role presets, signed governed scope
  lookup, recent-MFA step-up, opaque one-time invitation acceptance, explicit revocation, role/scope
  editing, suspend/restore, last-owner/self protections, and tenant-session invalidation. Focused
  API/UI evidence and a clean PostgreSQL 18 migration/lifecycle run pass, including MFA denial,
  one-time acceptance/replay denial, explicit revocation, scope/version mutation, session
  invalidation, self/last-owner protection, readiness and tenant RLS. The staff-session sub-tranche
  now adds administrator device visibility, targeted revocation, current-session protection and a
  readiness-gated migration, with the proof repeated against a freshly recreated PostgreSQL 18
  database. Administrator-triggered recovery is composed through the existing opaque recovery
  service and bilingual UI. Production OTP, invitation and recovery delivery remains
  activation-required until provider credentials and acceptance evidence exist.
- The 2026-08-30 H1 focused gate passed database/API/tenant-web strict types, production builds,
  lint, targeted migration/readiness/service/route/UI tests, accessibility assertions, static
  migration scope checks, and the live tenant-staff lifecycle script on both existing and freshly
  recreated PostgreSQL 18 databases.
- Orvex ISP Collect includes the offline queue, idempotent synchronization, device enrollment and
  rotation, receipt handling, conflict recovery, bilingual/RTL presentation, and the backend API and
  database vertical. Its focused security and offline-day invariant tests are included in the root
  validation gate.
- The Network Worker includes durable leases, retry and reconciliation behavior, RouterOS
  simulation, provider contracts, safe secret boundaries, health reporting, and a production
  composition. Live provider and router activation remains an external configuration step.
- Control Center, Tenant Operations, authentication, finance, Collect, summaries, readiness, the
  finance audit relay, and both web applications are composed by the production server and Compose
  deployment.
- On 2026-08-22 the public tenant route, Control Center route, and readiness endpoint each returned
  HTTP 200 over a valid Let's Encrypt certificate. The certificate was valid through 2026-11-12.
- Phase G's static release, observability, backup, restore and rollback kit is implemented and
  validated. The environment-dependent exercises listed above remain intentionally open rather than
  being represented as completed evidence.

## Latest foundation evidence

- The 2026-08-11 aggregate gate passed formatting, lint and strict type checks across eight
  workspaces; 15 test files with 76 unit/component/contract tests; every package, application and
  worker production build; the 218-file brand scan; compiled API smoke; schema safety; Compose
  parsing; and `git diff --check`.
- The production dependency audit reported zero vulnerabilities. Four moderate findings remain only
  in the Drizzle Kit development toolchain through an old `esbuild`, with no available upstream fix;
  it is not included in production dependencies or artifacts.
- A fresh isolated PostgreSQL 18 gate passed the roles-only 1530→1700 upgrade while preserving
  pending and delivered audit evidence; empty and prior-schema migrations; restricted-role and
  FORCE-RLS isolation; transaction-local pool cleanup; immutable finance; USD/LBP and exact
  idempotency rules; deterministic allocation/reversal races; atomic finance outbox rollback; and
  separate-plane retry/deduplication/API conflict mapping.
- The finance audit relay discovers pending tenant databases, drains bounded batches with retry and
  backlog readiness, preserves the complete authorized request envelope, and uses an event identity
  that cannot collide with ambiguous HTTP-failure evidence. Its hardened non-root, read-only image
  passed container smoke and graceful-shutdown checks.
- Fresh separate control and tenant PostgreSQL 18 databases now apply the scoped migration plans
  through Control Center 2100 and Operations 2200. Live tests prove signed HMAC contexts, SET-only
  Control role use, a restrictive lifecycle request with competing independent approvers, canonical
  Operations scope denial, billing-run concurrency, atomic tenant audit, commercial-state relay, and
  full-envelope audit relay. The run exposed and closed missing control pgcrypto, array encoding,
  control-plane audit columns, and relay schema-privilege defects before this gate was marked green.
- Independent database/security and Phase-B web reviews reported no unresolved critical, high or
  medium issue in the implemented foundation. The bilingual reference web routes, shared tokens, RTL
  preservation, mobile drawer containment, deep links and accessibility tests pass; Storybook,
  browser/assistive-technology visual evidence and the Collect reference flow remain Phase-B work.
- Subscriber 360 now includes one governed service-change workflow for plan upgrades, suspension,
  restoration and termination. The command is exact-replay safe, synchronizes subscriber/service
  commercial state with the durable router job, retains append-only reason/history, and passed the
  composed PostgreSQL acceptance path through subscriber closure.
- Catalogue/rating commercial truth now resolves service presentation and first billing from the
  same effective immutable plan version. Guarded schema, runtime API and bilingual publication UI
  cover technology, speed, quota, prepaid/postpaid, proration, FUP, included add-ons and overage;
  invoice preparations retain exact rating-policy and amount-component snapshots. Effective-dated
  purchasable add-ons and quota top-ups, append-only mediated usage, current-cycle balances and
  executable daily proration/overage/FUP rating now flow through the governed API and bilingual
  operator UI. Focused API/UI/schema evidence and clean PostgreSQL 18 replay-safe
  lead-to-rated-invoice proof pass with exact base, add-on, overage and VAT components.
