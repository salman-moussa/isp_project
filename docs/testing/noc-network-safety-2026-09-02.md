# NOC incident and network automation safety checkpoint — 2026-09-02

Status: focused local evidence complete; independent review and production activation outstanding.

## Delivered scope

- Bilingual, RTL-safe NOC incident queue, creation, detail, filtering, paging and guarded transition
  workflow.
- Canonically scoped routes and services; affected-customer counts are derived from persisted
  impacted services instead of operator-entered figures.
- Immutable impact and event history, version-checked lifecycle transitions, exact idempotent
  replay, bilingual reasons, resolution evidence and atomic Operations audit.
- Signed tenant/session authorization and deny-by-default FORCE RLS. Platform support is not allowed
  through these mutation boundaries.
- RouterOS REST safety corrections:
  - active sessions are read from `/ppp active` and a disconnect may delete only the requested
    active resource after proving it belongs to the managed account;
  - a PPP pool is written through `remote-address`;
  - `caller-id` is not used as a VLAN field;
  - unsupported VLAN changes fail before transport;
  - worker deadlines abort adapter transport;
  - an uncertain disconnect is reconciled only when a complete later observation excludes the target
    session;
  - an uncertain password rotation is held for human review and is never inferred from unchanged
    non-secret profile fields.
- The previous database-only RADIUS disconnect helper is fail-closed. A RADIUS accounting session
  identifier is not presented as proof of a NAS disconnect.

The RouterOS behavior above follows MikroTik's
[REST API resource semantics](https://manual.mikrotik.com/docs/developer-guides/rest-api/) and
[PPP AAA active-session and address-field documentation](https://help.mikrotik.com/docs/spaces/ROS/pages/132350049/PPP%2BAAA).

## Migration and rollback

`202609021808_tenant_noc_incident_workflow.sql` is a tenant-scoped forward migration and was applied
only to the local PostgreSQL test database. It must not be edited or renumbered. It adds incident
impacts/events and guarded functions, and strengthens the existing outage table and RLS.

Application rollback before any incident write can use the prior image. After incident writes,
rolling back the binary hides new workflows but must not remove the new tables, events, policies or
audit evidence. Database rollback is therefore forward-fix only.

## Evidence captured

- Local PostgreSQL 18 NOC proof:
  `tsx --conditions=development packages/database/scripts/test-live-noc.ts` — passed. It proved
  exact replay, changed-payload denial, permission and scope denial, cross-tenant denial, derived
  impact, version races, guarded resolution/reopen, raw-write denial, audit and paging.
- API focused suite: `node ../../node_modules/vitest/vitest.mjs run src/operations-api.test.ts` in
  `apps/api` — 30 tests passed.
- Tenant UI focused suite:
  `node ../../node_modules/vitest/vitest.mjs run src/noc/NocWorkspace.test.tsx` in `apps/tenant-web`
  — 5 tests passed.
- Network Worker: `npm test --workspace=@isp/network-worker` — 37 tests passed; production
  TypeScript build and changed-source ESLint passed.
- Contracts, database, API and tenant-web typechecks/builds passed for this checkpoint.
- English desktop and Arabic 390×844 RTL layouts were inspected with an explicitly local visual
  fixture. This was visual QA, not production API E2E.

## Explicit exclusions and production gates

This checkpoint does **not** make the full NOC or AAA capability complete. It does not deliver
device discovery, telemetry ingestion, alarm correlation, maintenance windows, SLA clocks,
communications, capacity forecasting, redundant RADIUS, RFC 5176 CoA/Disconnect, NAS-vendor mapping,
RouterOS VLAN/interface provisioning, or real-router acceptance.

Before production activation:

1. obtain independent review of the tenant-isolation and network-automation changes;
2. run the integrated signed-fixture validation gate;
3. configure a scoped secret reference and allowlisted HTTPS RouterOS test endpoint;
4. accept against a non-customer staging account on the exact RouterOS version;
5. implement and accept the ISP's actual NAS/RADIUS adapter before enabling disconnect;
6. approve a VLAN/interface mapping design rather than guessing from a PPP field;
7. deploy forward, run post-deploy signed smoke tests, and retain rollback/restore evidence.

No production host, router, RADIUS server or customer session was changed in this checkpoint.
