# Test fixtures and synthetic data

## Rules

Fixtures are deterministic, minimal, bilingual, non-sensitive, and visibly synthetic. Use reserved
domains (`example.test`), Lebanese-looking but non-real addresses and numbers, fixed UUIDs where
stable assertions matter, UTC instants with `Asia/Beirut` display assertions, and a seeded
pseudo-random generator for volume. Never use copied production exports, router configurations,
payment proofs, access tokens, or recognizable personal data.

Every integration run receives a unique namespace. Cleanup targets only resources carrying that
namespace; destructive reset commands must reject staging/production environment markers.

## Canonical personas and tenants

- `platform-owner`, `platform-support`, `platform-approver`, `platform-auditor`.
- Tenant Alpha and Tenant Beta with similar record counts and intentionally overlapping
  human-readable document numbers to expose missing tenant scopes.
- Per tenant: owner, finance, cashier, branch manager, collector, network operator, customer
  service, installer, auditor, restricted/no-export user.
- Support sessions: absent, pending, approved-limited, expired, and revoked.
- Authorized mobile device, revoked device, stale device, and a second collector's device.

## Required fixture dimensions

| Domain           | Cases                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Money            | USD/LBP; zero/rounding boundaries; partial/advance/deposit/credit; optional VAT off/on; large safe values    |
| Finance state    | Draft, posted, partially paid, paid, overdue, reversed/corrected; linked correction chain                    |
| Idempotency      | Same key/body, same key/different body, same key/different tenant, concurrent requests                       |
| Locations/scopes | Two branches, areas and routes per tenant; collector reassignment; out-of-scope records                      |
| Subscription     | Trial, active, grace, restricted, terminated, archived; all guarded transitions                              |
| Network          | Online/offline router, auth failure, timeout, known failure, partial, uncertain, rate-limited, reconciled    |
| Mobile           | Online/offline day, out-of-order operations, conflict, duplicate replay, printer failure, revoke mid-sync    |
| Files            | Valid safe PDFs/images plus generated MIME mismatch, large/bomb metadata and tenant-prefix negatives         |
| Webhooks         | Valid, invalid signature, old/future timestamp, duplicate ID, reordered, unknown type, wrong configuration   |
| Localization     | English/Arabic names, long text, Arabic/Latin mixed values, RTL layout; numerals do not alter stored meaning |

Passwords and local secrets are generated at test runtime or supplied by the test environment.
Documentation may name accounts but must not publish reusable credentials. Fixture factories return
domain objects through public creation paths unless the test explicitly targets a database
constraint.

## Time and concurrency

Freeze application time and test DST/offset transitions relevant to `Asia/Beirut`; store instants in
UTC. Billing date rules must define local calendar behavior. Concurrency tests use barriers/latches
rather than arbitrary sleeps and verify persisted state plus audit/outbox records.

## Production-like volume profile

The provisional reference profile is defined in `performance-plan.md`. Generate it rather than
checking large fixture dumps into source control. Record seed, generator version, counts and
checksum with every result so runs are reproducible.
