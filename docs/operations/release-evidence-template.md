# Release evidence — `<version>`

This is a template. Copy it to the approved evidence location and replace every placeholder; do not
mark unexecuted work as passed.

- Candidate commit / tag:
- Artifact and image digests:
- SBOM / provenance / signature links:
- Environment and IaC revision:
- Change window and incident channel:
- Release owner / operations / security / product approvers:

## Gates actually executed

| Gate                                      | UTC time | Command/workflow + immutable link | Result | Failures/fixes/skips |
| ----------------------------------------- | -------- | --------------------------------- | ------ | -------------------- |
| Lint/type/unit/integration/contract/build |          |                                   |        |                      |
| E2E/accessibility/RTL                     |          |                                   |        |                      |
| Secret/SAST/dependency/IaC/container/SBOM |          |                                   |        |                      |
| Migration validation                      |          |                                   |        |                      |
| Staging deploy/readiness/smoke/DAST       |          |                                   |        |                      |
| Backup confirmation / restore evidence    |          |                                   |        |                      |

## Change safety

- Configuration and feature-flag diff:
- Expand/migrate/contract plan and compatibility window:
- Pre-deploy backup decision and reason:
- Rollback criteria, last safe point and owner:
- Known limitations/residual risks and acceptance links:

## Production execution

- Start/end UTC and deployed digest:
- Readiness and smoke evidence:
- SLO/golden-signal comparison and observation window:
- Business invariant checks (tenant, money, sync, network):
- Rollback/forward-fix decision and incidents:
- Final status and approvals:
