# Web information architecture

## Product boundary

There are two distinct authenticated web applications:

1. **Orvex ISP Control Center** — private to Orvex Solutions staff. It operates ISP-client
   commercial relationships, platform subscriptions, packages, deployments, support, and aggregate
   health.
2. **Orvex ISP Operations** — private to an ISP’s staff. It operates subscribers, invoices,
   payments, collectors, network work, installations, reporting, and tenant configuration.

There is no customer portal, subscriber login, or end-subscriber account area. A future public
document verification page may reveal one invoice or receipt through an opaque token, but it must
remain a separate minimum-disclosure surface and must not reuse either authenticated shell.

## Orvex ISP Control Center navigation

| Order | Area               | Primary records/actions                                                         |
| ----- | ------------------ | ------------------------------------------------------------------------------- |
| 1     | Portfolio overview | Drillable client, revenue, renewal, deployment, backup, and support aggregates  |
| 2     | ISP clients        | Client list, create wizard, profile tabs, restrictions, restore, archive        |
| 3     | Sales pipeline     | Leads, needs assessment, quotations, proposals, conversion                      |
| 4     | Packages & add-ons | Versions, features, limits, pricing, entitlement impact                         |
| 5     | Subscriptions      | Trial, active, grace, restricted, terminated, archived transitions              |
| 6     | Billing & payments | Platform-client invoices, payment allocation, receipts, statements, corrections |
| 7     | Deployments        | Provisioning, domains, SSL, backups, updates, health, rollback                  |
| 8     | Support center     | Tickets, SLA, approvals, temporary scoped support sessions                      |
| 9     | Reports            | Revenue, aging, renewal, churn, health, support, audit, exports                 |
| 10    | Administration     | Platform users, roles, permissions, sessions, MFA, integrations, settings       |

Platform dashboards contain commercial metadata and permitted aggregate telemetry only. They do not
expose raw tenant subscriber PII. “Open workspace” begins the controlled support-access workflow; it
is not a silent cross-tenant navigation shortcut.

## Orvex ISP Operations navigation

| Order | Area                 | Primary records/actions                                                    |
| ----- | -------------------- | -------------------------------------------------------------------------- |
| 1     | Operations dashboard | Executive, finance, collections, branch, and network presets               |
| 2     | Subscribers          | Search, map, import, create/edit, statements, service and profile tabs     |
| 3     | Billing & invoices   | Invoice register, recurring rules, bulk runs, credits/debits, optional VAT |
| 4     | Payments & cashier   | Payment register, allocation, proof, receipt, reversal, drawers and shifts |
| 5     | Collectors           | Assignments, routes, progress, sync, reconciliation and discrepancies      |
| 6     | MikroTik network     | Live services, sessions, routers, profiles, pools/VLANs and durable jobs   |
| 7     | Installations        | Queue, calendar, checklist, equipment and activation handoff               |
| 8     | Internal support     | Tenant-only operational tickets linked to subscribers and records          |
| 9     | Reports              | Collections, cash, revenue, aging, debtors, subscribers, network and audit |
| 10    | Configuration        | Organization, branches, locations, routes, packages, users and policies    |

The branch/workspace context is persistent in the header. A context change must be explicit,
permission-checked, and preserve or intentionally clear incompatible filters with an explanation.

## Global shell hierarchy

```text
Skip link
└── Application shell
    ├── Product navigation
    │   ├── Orvex ISP identity
    │   ├── Ordered product areas
    │   └── Beirut timezone
    └── Work canvas
        ├── Context header
        │   ├── Control-plane or ISP-workspace identity
        │   ├── Portfolio / tenant / branch scope
        │   ├── Search
        │   ├── Language
        │   └── Signed-in staff account
        ├── Active support-session banner (tenant only, when applicable)
        └── Main content
            ├── Page heading and task actions
            ├── Exact drill-down metrics or saved view
            ├── Operational work surfaces
            └── Loading / empty / error / denied feedback
```

## Context and focus rules

- The active navigation item uses `aria-current="page"`.
- Selecting an app area closes the mobile drawer and moves programmatic focus to the main landmark
  without scrolling the user unexpectedly.
- Language switching changes copy and direction in place; it does not change the active area.
- The skip link is the first focusable element.
- Support-session scope, ticket, expiration, audit notice, and termination action appear before
  tenant main content for the entire session.
- Dashboard cards are buttons with an accessible drill-down purpose, not links to an unspecified
  dashboard.

## Dashboard drill-down pattern

Every KPI has a documented query contract: metric definition, current filters, data freshness,
permission scope, and target list. The initial shells demonstrate this by opening an inline
filtered-record panel. When route infrastructure is integrated, the same action should navigate to
the owning list with a serializable filter (for example, deployment health = attention) and keep a
visible filter chip. Browser Back must return to the dashboard with its prior state.

## Role-adaptive navigation

Navigation visibility may remove entire modules a role cannot access, but it must not use role names
as authorization. API permissions remain authoritative. When a user can see a module but not a
particular field or action, the UI preserves the module structure and presents masked fields or a
clear access-denied state with the smallest useful escalation path.
