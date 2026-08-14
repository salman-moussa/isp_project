# Orvex ISP release evidence — TEMPLATE / RELEASE BLOCKED

## Candidate identity

- Release/candidate:
- Source commit and clean-tree status:
- Dependency lock hash:
- Immutable API/web/worker image or artifact digests:
- SBOM/provenance/signature evidence:
- Schema migration manifest and compatibility window:
- Target profile/environment (synthetic staging or production):
- Approvers and authorization reference:

## Gates

| Gate                                                | Result (`pass`/`fail`/`missing`) | Executed command/time | Immutable evidence link/checksum | Owner |
| --------------------------------------------------- | -------------------------------- | --------------------- | -------------------------------- | ----- |
| clean dependency install/toolchain                  | missing                          |                       |                                  |       |
| format/lint/typecheck/unit/build                    | missing                          |                       |                                  |       |
| migration empty + upgrade + compatibility           | missing                          |                       |                                  |       |
| live PostgreSQL tenant/RLS/pool reuse/concurrency   | missing                          |                       |                                  |       |
| auth/support-grant/authorization matrix             | missing                          |                       |                                  |       |
| finance/idempotency/audit invariants                | missing                          |                       |                                  |       |
| Operations/Collect/network/provider simulators      | missing                          |                       |                                  |       |
| EN/AR, RTL, keyboard, screen reader, zoom, visual   | missing                          |                       |                                  |       |
| SAST/dependency/secret/container/SBOM/DAST          | missing                          |                       |                                  |       |
| PII/secret telemetry sentinel + cardinality         | missing                          |                       |                                  |       |
| reference load/spike/fairness                       | missing                          |                       |                                  |       |
| 8h/24h soak                                         | missing                          |                       |                                  |       |
| alert fire/route/dedup/recover drills               | missing                          |                       |                                  |       |
| encrypted backup/off-host/readability               | missing                          |                       |                                  |       |
| control/tenant/object/full isolated restore + smoke | missing                          |                       |                                  |       |
| application rollback/data-forward rehearsal         | missing                          |                       |                                  |       |
| deployment profile validation and post-deploy smoke | missing                          |                       |                                  |       |

## Measured objectives

Record accepted SLO/error budget, queue ages, billing completion, backup schedule, restore cadence,
RPO/RTO and measured result. “Not measured” is a blocker, not zero.

## Open findings and residual risks

List severity, evidence, owner, decision, mitigation and due date. Critical/high findings block
release. Accepted lower risks require named business/security/SRE approval. Include provider
credential/data still missing and any feature flag/manual fallback.

## Decision

- Decision: blocked / approved for named staging / approved for named production wave
- Scope/profile/tenant wave:
- Decision time and approvers:
- Pre-deploy backup/checksum:
- Rollback digest and schema-compatibility evidence:
- Bake window and abort thresholds:
- Post-deploy evidence:

This template itself is not evidence. Never mark a gate pass without command output or
external-system record tied to the candidate digest and environment.
