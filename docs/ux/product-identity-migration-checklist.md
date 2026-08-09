# Orvex ISP product-identity migration checklist

Temporary working checklist. Remove it only after the final release-candidate artifact scan and
identity review are recorded. ADR-0011 is the enduring decision record.

## Name contract

- [x] Umbrella product and repository: **Orvex ISP**
- [x] Orvex staff application: **Orvex ISP Control Center**
- [x] ISP tenant application: **Orvex ISP Operations**
- [ ] Collector application: **Orvex ISP Collect**
- [ ] Network process: **Orvex ISP Network Worker**
- [x] Vendor/company where needed: **Orvex Solutions**

## User-facing surfaces

- [x] Root README, contributor guide, and package description
- [x] Control Center browser title, metadata, English/Arabic shell copy, tests, and demo-data label
- [x] Operations browser title, metadata, English/Arabic shell copy, tests, and demo-data label
- [x] Shared wordmark, abstract connection/routing mark, and identity documentation
- [ ] Login, authentication recovery, splash, loading, and error pages when implemented
- [ ] PWA manifest, install icons, and offline shell when implemented
- [ ] Orvex ISP Collect configuration, splash, store metadata, and receipt views when implemented
- [ ] Network Worker logs/dashboards where a human-facing process label is rendered
- [ ] API/OpenAPI title and descriptions (owned by the API migration task)
- [ ] PDFs, invoices, receipts, exports, verification pages, email templates, and print output
- [ ] Container, deployment, monitoring, environment-example, and runbook labels
- [ ] Screenshots, visual-regression baselines, release notes, and final reports

## Verification

- [x] Known obsolete strings are covered by `scripts/brand-check.mjs`
- [ ] Root `package.json` exposes `brand:check` as `node scripts/brand-check.mjs`
- [ ] Brand check is included in the integrated validation pipeline
- [x] Stable internal `@isp/*` package identifiers are documented in ADR-0011
- [ ] Final scan runs after all build and document generation steps
- [ ] Independent English/Arabic identity review confirms no old visible label remains

Do not check an item solely because its source was renamed. Generated output and the rendered
surface must both be reviewed. The checklist does not authorize renaming internal compatibility
identifiers or migration history.
