# Competitive and operational UX review

## Scope and method

This short audit uses public product pages and official documentation only. It looks for familiar
operational patterns that reduce training and error risk; it does not treat another product as a
visual template. Authenticated screens, scraped customer data, private sandboxes, and third-party
reviews are outside scope. The no-subscriber-portal boundary for Orvex ISP overrides competitor
feature sets.

## Official sources reviewed

| Source                                                                                                                                                                                                                                                       | Public material reviewed                           | Relevant signals                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Splynx](https://splynx.com/) and [ISP billing](https://splynx.com/isp-billing/)                                                                                                                                                                             | Product overview and billing capabilities          | Billing, CRM, network management, payment handling, and subscriber context belong to one operational system; automation still needs visible exceptions and review.       |
| [Sonar](https://sonar.software/)                                                                                                                                                                                                                             | Official platform overview                         | A unified account context can connect billing, inventory, network, and service work without making every task start from a dashboard.                                    |
| [UISP CRM API](https://help.uisp.com/hc/en-us/articles/22590956856087-UISP-CRM-API-Usage)                                                                                                                                                                    | Official API usage guidance                        | Integration behavior should have explicit authentication, scope, and operational failure handling.                                                                       |
| [UISP prepaid/reactivation](https://help.uisp.com/hc/en-us/articles/22590998643351-UISP-CRM-Prepaid-Service-and-Service-Reactivation)                                                                                                                        | Official prepaid and service-reactivation workflow | Service-state transitions need visible prerequisites and consequences; Orvex ISP must keep tenant software subscription state separate from subscriber internet service. |
| [MikroTik RouterOS REST API](https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST%2BAPI), [API](https://help.mikrotik.com/docs/spaces/ROS/pages/47579160/API), and [user permissions](https://help.mikrotik.com/docs/spaces/ROS/pages/8978504/User) | Official interfaces and access controls            | Router actions need least-privilege credentials, durable job status, bounded retries, and an explicit uncertain outcome rather than optimistic UI success.               |
| [Carbon data table](https://carbondesignsystem.com/components/data-table/usage/) and [accessibility](https://carbondesignsystem.com/components/data-table/accessibility/)                                                                                    | Table usage and accessibility guidance             | Record-heavy pages benefit from real table semantics, persistent context, deliberate batch actions, and status conveyed with more than color.                            |
| [GitHub Primer accessibility](https://primer.style/accessibility/) and [engineering checklist](https://primer.style/accessibility/tools-and-resources/checklists/engineering-checklist/)                                                                     | Accessibility principles and implementation review | Keyboard, focus, labels, semantics, zoom, and assistive-technology review are engineering acceptance criteria, not a final polish step.                                  |
| [Atlassian Dynamic Table](https://atlassian.design/components/dynamic-table/)                                                                                                                                                                                | Official dynamic-table documentation               | Sorting, pagination, loading, and empty states should be part of the component contract and remain understandable at operational density.                                |
| [GOV.UK patterns](https://design-system.service.gov.uk/patterns/)                                                                                                                                                                                            | Task and form patterns                             | Plain language, one question/task at a time where risk warrants it, error summaries, confirmation, and check-answers steps support consequential workflows.              |

## Useful workflow patterns

- Give each ISP client or subscriber a stable context that joins relevant records without exposing
  data outside the current tenant or approved support scope.
- Let aggregate counts open the exact filtered list behind them. Preserve visible filters and Back
  behavior.
- Prefer compact tables, saved views, selection summaries, and side details for record work; use
  cards only when they represent a distinct task or drill-down.
- For payments, reactivation, package changes, bulk changes, and router commands, show
  prerequisites, affected records, exclusions, consequences, permission, reason, and final durable
  status.
- Distinguish queued, running, applied, failed, partially applied, and uncertain operations. A
  spinner is not evidence that a network or financial action succeeded.
- Treat validation, empty, denied, stale, offline, conflict, and retry states as part of each flow.

## Unsuitable assumptions for Lebanese ISPs

- A subscriber self-service portal is not part of Orvex ISP. Staff, collectors, phone/WhatsApp
  sharing, print, PDFs, and minimal single-document QR verification are the supported boundaries.
- Card payments, stable connectivity, one currency, standardized street addresses, and continuous
  field synchronization cannot be assumed. Cash, OMT/Whish/manual fallback, USD/LBP separation,
  Lebanese address structure, Arabic, and offline collector work must be first-class.
- Vendor staff must not browse tenant subscriber PII by default. Support access is approved, scoped,
  visible, expiring, revocable, and audited.
- Restricting an ISP client's Orvex ISP platform subscription must never suspend that ISP's
  subscribers or enqueue router commands.
- Router APIs and payment providers are not inherently reliable. The interface must represent
  idempotency, reconciliation, manual review, and uncertain outcomes honestly.

## What Orvex ISP will do differently

- Separate the portfolio/commercial Orvex ISP Control Center from the high-speed tenant workbench in
  Orvex ISP Operations, while sharing accessible components and terminology.
- Keep USD and LBP visibly separate through entry, review, posting, receipt, report, and
  reconciliation. Optional conversion always records rate, date, source, and approval.
- Optimize common office and collection tasks for bilingual English/Arabic use, RTL, keyboards,
  dense laptop layouts, and touch-friendly field workflows.
- Make support scope and demo/stale/offline data status persistent instead of hiding them in account
  menus or relying on a green dot.
- Reserve charts for an operational question and always provide the decisive numbers or table.

## Original Orvex ISP design principles

1. **Task before dashboard:** lead with the current context, queue, and next safe action.
2. **Evidence before optimism:** show posted identifiers, timestamps, source, scope, and uncertain
   outcomes; never imply success from client-side activity alone.
3. **Boundaries remain visible:** tenant, branch, support grant, currency, and
   service-versus-platform subscription boundaries appear at the decision point.
4. **Bilingual by construction:** English and Arabic share meaning, permission, value, and workflow;
   layout uses logical properties and stable technical runs.
5. **Density with calm:** alignment, typography, borders, and restrained semantic color carry the
   hierarchy instead of repeated decorative cards, gradients, glow, or glass.
6. **Consequences before commitment:** financial, bulk, destructive, and network actions include an
   impact review and a recoverable correction or reconciliation path.

## No-copy statement

Orvex ISP will not copy a competitor's page composition, visual identity, branding, assets, text,
icons, screenshots, code, seeds, or proprietary behavior. Public, familiar operational concepts may
inform task models, but the information architecture, connection-and-routing “O” mark, semantic
tokens, bilingual copy, components, and final page composition are original to Orvex ISP. No
competitor trademark or customer data belongs in Orvex ISP screens or fixtures.
