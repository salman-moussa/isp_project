# ADR-0011: Orvex ISP product identity and legacy identifiers

- Status: Accepted
- Date: 2026-08-09
- Deciders: Product Owner, Architecture, Design, Security
- Requirements: controlled product-identity migration
- Risks: accidental user-visible legacy branding; unsafe technical renames

## Context

The product identity is Orvex ISP and the vendor identity is Orvex Solutions. Earlier foundation
work used temporary names in browser metadata, navigation, sample content, documentation, and the
shared mark. A broad rename of technical identifiers would also change package resolution,
deployment configuration, database objects, caches, and compatibility contracts without adding user
value.

## Decision

The user-facing name contract is:

- **Orvex ISP** for the umbrella product and repository;
- **Orvex ISP Control Center** for the private Orvex Solutions application;
- **Orvex ISP Operations** for each ISP tenant's operational workspace;
- **Orvex ISP Collect** for the internal collector application;
- **Orvex ISP Network Worker** for the internal network-automation process; and
- **Orvex Solutions** only when a vendor/company identity is required.

Browser titles, metadata, navigation, app copy, documentation, generated customer artifacts, and
other user-visible surfaces must use this contract. Demonstration shells must label seeded content
as demonstration data and must not claim a live integration or production environment.

The existing `@isp/*` npm scope and stable internal package names remain compatibility identifiers.
Existing database names, environment keys, event names, permission values, route segments,
container/service names, metric identifiers, and migration history may also remain when they are not
user-visible. A future technical rename requires a separate compatibility plan, dual-read or alias
period where applicable, rollback strategy, and migration evidence. These identifiers must never be
rendered as the product or vendor identity.

An automated brand check scans user-facing sources and built artifacts for the known obsolete
identity strings. Historical ADR text and competitive research are excluded because they are
records, not product surfaces.

## Consequences

- Users receive one consistent product and vendor identity.
- Stable package imports and operational contracts avoid unnecessary migration risk.
- Contributors must distinguish product labels from internal identifiers during future work.
- The temporary migration checklist remains open until every app and generated artifact exists and
  has been scanned.

## Rejected alternatives

- Rename every `@isp/*` package immediately: large compatibility cost with no user-facing benefit.
- Keep temporary names in demo shells: creates screenshots and tests that perpetuate the wrong
  identity.
- Present seeded values as production/live data: overstates implementation and integration status.

## Validation

Run `node scripts/brand-check.mjs`, focused web tests, both web builds, and a visual English/Arabic
review. Re-run the brand check after generating distributable web, document, mobile, and store
artifacts.
