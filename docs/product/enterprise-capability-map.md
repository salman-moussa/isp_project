# Orvex ISP enterprise capability map

Status: controlling expansion baseline, 2026-08-28  
Owner: Product, Architecture, Security, Finance, Network Operations  
Market focus: Lebanese fixed, wireless, fiber, reseller, and mixed-access ISPs

## Objective

Orvex ISP is the primary operating system for an ISP. Authorized ISP employees should be able to run
sales, subscriber operations, service delivery, billing, collections, network operations, support,
field work, inventory, finance, compliance, and management reporting without maintaining parallel
spreadsheets or disconnected operational databases.

This objective does not permit simulated production success. A capability is considered delivered
only when its UI, API, authorization, persistence, audit, bilingual presentation, failure states,
and relevant worker or provider boundary operate together. External providers may remain
`activation_required`, but the product must identify the missing contract or credential precisely.

The existing prohibition on a subscriber login remains. This map describes ISP employee and Orvex
operator capabilities; it does not create a subscriber portal.

## Evidence from the Lebanon market

The capability map is based on public behavior and obligations, not assumptions about another
provider's private software:

- Lebanon's Telecommunications Law licenses Internet and data services and permits licence
  obligations for information, inspection, quality, expansion, renewal, and continuity. See the
  [TRA Telecommunications Law 431/2002](https://www.tra.gov.lb/Telecom-Law-431-2002).
- TRA consumer guidance calls for privacy, tariff transparency, clear itemized bills, complaint
  redress, and quality-of-service monitoring. The QoS regulation explicitly covers billing accuracy,
  service availability, network performance, and dispute procedures. See the
  [TRA Consumer Affairs Guidelines](https://www.tra.gov.lb/library/files/uploaded%20files/consumer%20affairs.htm)
  and
  [Technical QoS and KPI Regulation](https://www.tra.gov.lb/Library/Files/Uploaded%20files/QoS_Regulation_English.htm).
- Lebanon's Ministry of Finance requires tax invoices to contain supplier, recipient, service,
  serial number, date, amount, tax amount, and rate; its guidance says accounting records and
  invoices must be retained for ten years. See
  [Issuance of tax invoices and record keeping](https://finance.gov.lb/ar-lb/Taxation/Individuals/VAT/Pages/Issuance-of-the-Tax-Invoice-and-Book-Keeping.aspx).
- Ogero's public catalogue demonstrates capacity circuits for ISPs plus xDSL, HDSL, LTE, and fiber
  access with feasibility, activation fees, quotas, top-ups, over-consumption, capping, and fair-use
  rules. See [International Internet Capacity Circuit](https://ogero.gov.lb/service.php?id=33&type=)
  and [business Internet plans](https://ogero.gov.lb/service.php?id=51&type=business).
- Public IDM and Cyberia workflows show prepaid and postpaid accounts, bank domiciliation, cards,
  online payments, authorized dealers, OMT, Whish, LibanPost/Cash United, plan changes, pauses,
  add-ons, extra quota, TV bundles, consumption views, and support requests. See the
  [IDM Fiber FAQ](https://www.idm.net.lb/fiber-faq.html) and
  [Cyberia Fiber FAQ](https://www.cyberia.net.lb/faq-fiber.php).
- MikroTik documents centralized PPP/PPPoE authentication and accounting through RADIUS, active
  session monitoring, and RouterOS automation. See
  [RouterOS PPP AAA](https://help.mikrotik.com/docs/spaces/ROS/pages/132350049/PPP%2BAAA),
  [RADIUS](https://help.mikrotik.com/docs/spaces/ROS/pages/328097/RADIUS), and
  [REST API](https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST%2BAPI).
- Broadband Forum TR-069/USP models cover managed CPE interfaces, diagnostics, firmware, and
  components. TM Forum's telecom capability model and Open APIs cover customer, product, order,
  service, resource, trouble-ticket, and bill management. See
  [Broadband Forum USP](https://www.broadband-forum.org/public/certifications/tr-069-evolution-to-usp/),
  [TM Forum capability framework](https://www.tmforum.org/open-digital-architecture/capability-framework/),
  and
  [TM Forum Open API dashboard](https://www.tmforum.org/open-digital-architecture/about-open-apis/open-api-dashboard/).

Legal, tax, licence, and retention values must still be approved by the ISP's qualified owners
before production configuration. Public source research is not legal or tax advice.

## Delivery status vocabulary

| Status                | Meaning                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `foundation`          | Secure domain primitives exist, but the complete daily workflow is not delivered.                    |
| `partial`             | A real vertical exists, but material list/detail, lifecycle, reporting, or UI work remains.          |
| `missing`             | No production vertical currently covers the capability.                                              |
| `activation_required` | Software boundary exists; an external contract, credential, device, or acceptance result is missing. |
| `verified`            | Complete UI/API/data/worker workflow and acceptance evidence exist.                                  |

No capability in this expansion is marked `verified` until its release evidence is linked here.

## Enterprise capability inventory

| Domain                               | Required operating capabilities                                                                                                                                                       | Current state                     | Next acceptance target                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Organization and IAM                 | Employee directory, tenant roles, permission and field scopes, branches/areas/routes, invitations, password recovery, MFA policy, sessions, devices, delegation, separation of duties | `partial`                         | ISP administrator can onboard, scope, suspend, recover, and audit every staff role; collector onboarding works end to end. |
| CRM and sales                        | Leads, campaigns/sources, opportunities, feasibility, needs survey, site visit, quotation versions, discounts/approval, contracts, win/loss, handoff                                  | `partial`                         | Lead-to-service-order workflow preserves commercial and technical history without duplicate conversion.                    |
| Product and offer catalogue          | Access technology, speed, quota, FUP, burst, add-ons, TV/static IP, prepaid/postpaid, commitment, activation/equipment fees, VAT/stamp rules, eligibility, effective versions         | `partial`                         | Versioned sellable offers drive qualification, order, billing, provisioning, and history consistently.                     |
| Address and service qualification    | Governorate/district/village/area, geocode, building, Ogero exchange/line, POP/sector/OLT coverage, capacity, LOS/signal/fiber feasibility, survey evidence                           | `partial`                         | Sales receives an explainable eligible/ineligible result and capacity reservation before commitment.                       |
| Subscriber and party management      | Person/business, contacts, identity controls, consent, addresses, household/company relationships, documents, duplicate detection, lifecycle, privacy requests                        | `partial`                         | Complete bilingual list/detail/wizard/import/archive and controlled sensitive-field workflow.                              |
| Order orchestration                  | Quote/order, decomposition into commercial/service/resource tasks, dependencies, appointments, holds, fallout, retries, cancellations, changes, completion                            | `partial`                         | One accepted order coordinates installation, inventory, network activation, and first billing idempotently.                |
| Service inventory                    | Internet service instances, access circuit, PPPoE/RADIUS identity, IP assignment, CPE, plan version, status, dependencies, history                                                    | `partial`                         | Every billed service reconciles to one current technical service and complete change history.                              |
| Resource and outside-plant inventory | Sites, POPs, towers, rooms, racks, power, routers, switches, OLT/ONT, radios, sectors, links, splitters, fibers, ports, VLANs, IP pools, spares, diagrams                             | `partial`                         | Scoped capacity resources and atomic service-order reservation are live; topology, assets and attachments remain.          |
| Warehouse and procurement            | Items/SKUs, serialized assets, vendors, quotes, POs, receiving, warehouses/bins, transfers, reservations, issue/return, RMA, reorder, valuation                                       | `missing`                         | Installation cannot consume unavailable equipment; every serialized CPE has custody and financial history.                 |
| Installation and field service       | Skills, territories, shifts, dispatch board, appointment windows, routes, mobile jobs, checklist, photos, materials, signal tests, customer handoff, revisit                          | `partial`                         | Dispatcher-to-technician-to-activated-service flow works online/offline with inventory consumption and SLA.                |
| AAA and access control               | RADIUS clients/NAS, PPPoE/Hotspot/DHCP identity, auth policy, simultaneous use, profiles/rate limits, accounting start/interim/stop, CoA/disconnect, session history                  | `missing`                         | Redundant AAA path authorizes current service state and reconciles accounting without storing plaintext secrets.           |
| IPAM and network configuration       | IPv4/IPv6 pools, prefixes, VLANs, addressing, reservations, DNS records, CGNAT/public IP, configuration templates, change plans, approvals, rollback                                  | `partial`                         | Address/resource allocation and RouterOS execution are conflict-safe, approved, observable, and reversible.                |
| CPE lifecycle                        | Model/firmware inventory, provisioning, configuration, Wi-Fi, diagnostics, signal/optical levels, reboot/reset, firmware rollout, TR-069/USP adapter                                  | `missing`                         | Approved CPE models can be safely provisioned and diagnosed with secrets and customer data protected.                      |
| NOC and service assurance            | Discovery, topology, polling/streaming telemetry, alarms, dedup/correlation, maintenance, outages, impacted services, escalation, status timeline, RCA/problem/change                 | `missing`                         | Device/link alarm produces an impact-scoped incident, communication tasks, SLA clock, recovery evidence, and RCA.          |
| Capacity and upstream management     | Ogero/upstream circuits, transit/peering, committed/burst capacity, utilization, cost, SLA, renewals, guarantees, upgrade forecasts, POP/sector/OLT saturation                        | `missing`                         | Capacity risks and commercial renewal obligations are visible before customer impact.                                      |
| Billing and rating                   | Prepaid/postpaid cycles, recurrence, proration, quota/usage, top-ups, overage, FUP/capping, fees, VAT/stamp configuration, discounts, credits, deposits, dunning                      | `partial`                         | Rated service usage produces exact, itemized, immutable, legally configured invoices and balance by currency.              |
| Accounting and treasury              | Chart of accounts, journals, AR/AP, cashboxes, banks, deposits, expenses, vendors, tax, period close, trial balance, P&L, balance sheet, cash flow, budgets                           | `missing`                         | Operational billing and payments reconcile into controlled double-entry books and period close.                            |
| Revenue assurance and fraud          | Billed-vs-active, usage-vs-rating, payment allocation, duplicate/gap detection, unauthorized service, collector variance, voucher/dealer exposure, leakage cases                      | `partial`                         | Daily controls create assigned cases with measurable financial exposure and closure evidence.                              |
| Payments and cash channels           | Office/collector cash, card/POS, bank, domiciliation, transfer, OMT, Whish, LibanPost/Cash United adapters, proof, settlement, chargeback/refund, reconciliation                      | `partial` / `activation_required` | Each configured channel posts once and reconciles provider settlement, fees, currency, cashbox, and bank deposit.          |
| Dealer/reseller and vouchers         | Dealer hierarchy, POS users, commission, credit limit, stock, PIN/voucher batches, activation, top-up, settlement, fraud controls, territory                                          | `missing`                         | Dealer sale/top-up is atomic, traceable, limited, reconciled, and commissionable.                                          |
| Collections                          | Route planning, assignment, offline payment, receipt, printer, cash handover, discrepancy approval, revocation recovery                                                               | `partial` / `activation_required` | Production collector account, OTP, approved printer, live assignments, and end-of-day acceptance pass.                     |
| Customer service and complaints      | Omnichannel intake, caller verification, subscriber/service context, ticket/SLA, complaint classification, escalation, outage linkage, knowledge, redress, reopen                     | `partial`                         | Agent resolves a complaint with complete SLA, communications, decision, and audit history.                                 |
| Communications                       | Approved SMS/email/WhatsApp/provider templates, Arabic/English preference, billing/reminder/outage/appointment events, consent, retry, delivery receipt, suppression                  | `activation_required`             | Notification worker delivers approved templates idempotently with consent and delivery evidence.                           |
| Documents and verification           | Quotes, contracts, invoices, receipts, statements, service forms, tax fields, numbering, PDF/archive, attachments, malware scan, one-document public verification                     | `partial`                         | Bilingual documents render, archive, retain, and verify one opaque authorized document without a portal.                   |
| Regulatory and QoS                   | Licence/renewal register, obligations, tariffs, coverage/expansion, KPI definitions, sampling, availability, faults/MTTR, complaints, periodic submissions, evidence retention        | `missing`                         | Reproducible regulator-ready reporting traces each number to retained source evidence.                                     |
| Management analytics                 | Executive, sales, churn, AR/aging, revenue, cash, network health, SLA, capacity, workforce, inventory, dealer, compliance, branch profitability                                       | `partial`                         | Every KPI drills into a reconciled authorized dataset; currencies and time windows remain explicit.                        |
| People operations                    | Employee record, teams, skills, shifts/on-call, leave/availability, training/certification, goals; payroll only through an approved localized accounting boundary                     | `missing`                         | Scheduling and access lifecycle share one employee identity without employee surveillance.                                 |
| Security and audit                   | Tenant isolation, RBAC/ABAC, step-up, approvals, secrets, session/device control, immutable audit, incident register, vulnerability/patch, backup access                              | `foundation`                      | Every sensitive workflow has deny-path, approval, audit, redaction, recovery, and operations evidence.                     |
| Integration and data management      | Versioned API/webhooks, idempotency, provider adapters, import/export, mapping, validation, lineage, archival, retention, deletion/legal hold                                         | `partial`                         | External exchange is observable, replay-safe, scoped, documented, and recoverable.                                         |
| Platform operations                  | Multi-tenant lifecycle, entitlements, deployment, health, observability, backup/restore, DR, rollback, support access, updates, data export/exit                                      | `partial`                         | Production-scale load, restore, rollback, DAST, alert response, and tenant exit exercises are recorded.                    |

## Implementation waves

Each wave is delivered as small vertical tranches. A tranche is pushed only after focused tests,
builds, migration safety, and a real UI-to-database acceptance path pass.

1. **Truth and access foundation** — replace demo-only surfaces with real read models; staff/role
   administration; MFA/OTP activation; collector onboarding; capability status and audit visibility.
2. **CRM, catalogue, qualification, and orders** — lead through technically qualified, accepted,
   orchestrated service order.
3. **Subscriber and service workspace** — production list/detail/search/import, service inventory,
   documents, privacy controls, and change lifecycle.
4. **Resources, warehouse, and field delivery** — network/resource inventory, stock/procurement,
   dispatch, mobile installation, asset custody, and activation handoff.
5. **AAA, IPAM, CPE, and configuration** — RADIUS accounting, address resources, RouterOS changes,
   TR-069/USP boundary, diagnostics, and reconciliation.
6. **NOC and assurance** — telemetry, topology, alarms, outage impact, incident/problem/change,
   maintenance, capacity, upstream obligations, and QoS evidence.
7. **Rating, billing, accounting, and revenue assurance** — quota/usage rating, complete invoice
   content, dunning, double-entry accounting, period close, leakage controls, and audit.
8. **Payments, dealers, vouchers, and collections** — all configured channels, settlements,
   commissions, cashboxes, printer acceptance, and reconciliation.
9. **Service care, communications, and documents** — complaint/redress, knowledge, approved
   notifications, PDF/archive, and single-document verification.
10. **Regulatory, people operations, analytics, and enterprise administration** — obligations,
    reports, scheduling/skills, budgets, executive analytics, retention, and master data.
11. **Enterprise release acceptance** — production-volume performance, security review, restore,
    rollback, provider failover, hardware matrix, accessibility/RTL, and owner sign-off.

## Rules for every future tranche

- Do not add a navigation item until its authorized read path and primary workflow are functional.
- Do not show demonstration records inside an authenticated production session.
- Do not label a capability active when its provider, worker, credential, or hardware is absent.
- Do not bypass MFA, approval, licence, tax, finance, tenant, or secret controls to make a demo
  pass.
- Do not combine USD and LBP without an explicit, versioned, traceable conversion transaction.
- Do not make network access state depend on the Orvex platform subscription state.
- Do not introduce a subscriber account or subscriber-authenticated portal.
- Do not copy competitor UI, text, code, documents, or proprietary behavior.
- Do not close a tranche with only unit tests; prove the composed vertical at the appropriate layer.

## Immediate next tranche

Continue from the proven usage/add-on rating vertical into versioned tax eligibility, stamp and
discount rules, legal bilingual invoice rendering, recurring-run recovery and an explainable
dunning lifecycle. Each invoice line, adjustment and collection action must trace to its source
version and event while preserving explicit USD/LBP amounts, immutable commercial/finance history,
exact idempotency, scoped authority and bilingual operator guidance. Relocation remains coupled to
the later field/resource delivery tranche.

Production identity activation additionally requires an approved OTP/notification provider.
Development and test adapters may expose codes only in explicitly non-production environments.
