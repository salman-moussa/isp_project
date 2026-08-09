# Test and quality strategy

Status: Phase 1 strategy. Results belong in timestamped evidence records; this document makes no
pass claim.

## Principles

Tests prioritize tenant isolation, authorization, financial correctness, idempotency, offline
recovery, support access, and network safety over a vanity coverage percentage. Production defects
become regression tests. Deterministic tests use synthetic data, frozen time, seeded randomness,
fake providers, and a MikroTik simulator. No test uses real subscriber or credential data.

## Test pyramid and ownership

| Layer                          | Purpose                                                                            | Expected location / owner                  |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| Unit and property/table driven | Domain invariants, money/tax/proration, states, permissions, formatters, reducers  | Beside packages/services; feature owner    |
| Component/accessibility        | Loading/empty/error/denied/success, keyboard, semantics, EN/AR and RTL             | Web/mobile/UI packages; surface owner      |
| Database integration           | Constraints, transactions, isolation, locks, concurrency, migrations               | Core service test suite; backend/data      |
| API integration                | Validation, authz, tenant scope, pagination, idempotency, errors, limits, webhooks | Core service; backend                      |
| Contract                       | OpenAPI-client parity, core/network protocol, provider adapter compliance          | Contract package; integration owners       |
| Browser/mobile E2E             | Critical user outcomes across surfaces, offline/device behavior                    | Dedicated E2E projects; QA + feature owner |
| Security                       | Threat cases and supply-chain gates                                                | CI/staging; security + owners              |
| Performance/reliability        | p95, saturation, queue/restart, load/soak                                          | Isolated performance environment; SRE      |
| Recovery/UAT                   | Restore and role-based business acceptance                                         | Isolated restore/staging; SRE/product      |

## Mandatory quality gates

On applicable changes: formatting, lint, type checks, static analysis, unit/component tests,
database/API tests, OpenAPI/contract checks, builds, accessibility/RTL checks, migrations,
secret/SAST/dependency scans, container scan and SBOM. Critical E2E runs on merge or a protected
staging gate when its infrastructure cannot safely run per pull request. Production additionally
requires immutable staging artifact promotion, smoke/DAST, backup confirmation, migration and
rollback review, security review, UAT sign-off, and manual approval.

A missing script may be reported as `not-applicable` only while its project is genuinely absent.
Once a workspace exists, missing required scripts are a gate failure or a documented time-bounded
exception. Never use `continue-on-error` for a release gate.

## Coverage expectations

- 100% decision-table coverage for lifecycle transitions, permission/approval rules, financial
  posting/correction, idempotency, sync conflicts, and network job state transitions.
- Mutation testing or equivalent focused review is recommended for critical calculators and
  policies.
- Changed code should not reduce repository thresholds. Line/branch thresholds are set by each
  package after a measured baseline, but critical invariants are never waived because aggregate
  coverage is high.
- Every tenant-owned repository/query/job/file/cache/channel/export/backup adapter has a
  cross-tenant negative test.

## Environment matrix

| Environment      | Data                                      | External integrations         | Purpose                                    |
| ---------------- | ----------------------------------------- | ----------------------------- | ------------------------------------------ |
| Unit             | In-memory/factories                       | Fakes                         | Fast deterministic feedback                |
| Integration      | Disposable PostgreSQL/Redis/MinIO/Mailpit | Fakes/simulators              | Transactions and boundaries                |
| Preview          | Synthetic seed per change                 | Fakes/sandbox only            | UI/E2E/accessibility                       |
| Staging          | Production-like synthetic volume          | Explicit sandbox/manual modes | Migration, load, DAST, UAT, recovery smoke |
| Isolated restore | Encrypted test backups only               | Disabled                      | Backup/restore/DR exercises                |

Production data must not be copied to lower environments without an approved, verified anonymization
process. Test jobs use unique run IDs and clean only their own resources.

## Critical automated scenarios

1. Tenant A cannot reach Tenant B through API, database, job, cache/lock, object, realtime, export,
   backup, or support paths.
2. Support requires non-self approval, minimum scope, visible banner, expiry/revocation, and
   complete read/write audit.
3. Platform restriction never creates or mutates subscriber Internet/network state.
4. Duplicate and concurrent payment/invoice/receipt/sync/network requests remain exactly-once at the
   business-record level.
5. Failed bulk billing retries only failed items; uncertain router outcomes reconcile before retry.
6. USD and LBP remain distinct across storage, API, UI, PDF, report, export, sync, reconciliation,
   and Arabic/RTL display.
7. Posted finance is immutable; authorized linked corrections preserve the chain.
8. Revoked devices receive neither assignments nor sync acceptance; printer failure never loses a
   posted payment.
9. Upload, webhook, public verification, export and rate-limit abuse cases fail safely.
10. Restored control-plane, single-tenant, full-environment and object data pass identity and smoke
    checks.

## Defect and flake policy

Severity is based on user impact, data/financial integrity, tenant exposure and recoverability.
Critical/high security, isolation, money-loss, unrecoverable-data, or mass-network risks block
release. A flaky gate is a defect: quarantine requires owner, issue, evidence, expiry and equivalent
blocking coverage; silent retries are prohibited. CI records first-attempt outcomes and any
diagnostic rerun separately.

## Exit evidence

A phase/release evidence index includes commit and artifact digests, environment/configuration,
executed commands, test counts, failures and fixes, known skips with reason, security results,
migration/rollback review, UAT approval, and restore/deployment exercise links. Plans and templates
are never listed as executed evidence.
