# User acceptance checklist

Use synthetic staging data. Record tester role, UTC date, artifact digest, browser/device, language,
result, issue and approval. Product owner acceptance does not waive security or data-integrity
gates.

## Platform team

- [ ] Owner/admin manages users, permissions, sessions, MFA and approval policy.
- [ ] Sales converts a lead using package/quotation data without electronic signature requirements.
- [ ] Finance invoices and records partial/advance payments in USD and LBP without combining them.
- [ ] Subscription grace/restrict/restore follows policy and never affects ISP subscriber service.
- [ ] Deployment admin sees resumable steps, health, backup state, release and rollback information.
- [ ] Support agent cannot enter tenant data until independently approved; tenant sees the banner;
      revoke/expiry is immediate and audited.
- [ ] Auditor can inspect but not mutate commercial, deployment, access and audit records.

## ISP operations

- [ ] Owner/admin configures branches, areas, routes, roles, optional VAT and numbering.
- [ ] Finance performs recurring billing, partial allocation, deposit/credit, linked correction and
      per-currency reporting.
- [ ] Cashier records a payment and produces English and Arabic receipts; reprint is
      controlled/audited.
- [ ] Branch manager completes collector handover and reconciliation by method/currency including a
      variance.
- [ ] Customer service sees permitted subscriber/billing fields only.
- [ ] Installer completes the simple installation checklist and activation handoff.
- [ ] Auditor confirms posted records cannot be silently edited/deleted.

## Mobile and network

- [ ] Collector completes a full online day and a full offline day; repeat sync creates no
      duplicate.
- [ ] Conflict is understandable/recoverable; printer failure does not lose payment; revoked device
      is blocked.
- [ ] Network operator previews/approves a bulk job and handles success, known failure and uncertain
      state through reconciliation.
- [ ] Router credentials never display in UI, audit, logs or test artifacts.

## Cross-cutting and operations

- [ ] English/Arabic, LTR/RTL, keyboard, screen reader basics and supported responsive layouts are
      usable without changing values/meaning.
- [ ] Exact filtered lists back dashboard KPIs.
- [ ] Export is authorized/audited and spreadsheet formula payloads are neutralized.
- [ ] Public QR verifies one document with minimum disclosure and offers no subscriber
      login/navigation.
- [ ] Operator executes staging deployment/smoke and a controlled isolated restore using the
      runbooks; evidence links are attached.
- [ ] Known limitations, support contacts, release/rollback notes and accepted residual risks are
      understood and approved.
