# Architecture decision records

ADRs are immutable decision history. Update the status and add a superseding ADR rather than
rewriting an accepted decision's outcome. `Proposed` decisions require the named review before Phase
1 gate; implementation may spike them but must not silently diverge.

| ADR                                                       | Decision                                                         | Status                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| [0001](0001-application-stack-and-modular-monolith.md)    | Application stack and modular monolith                           | Proposed                                |
| [0002](0002-tenancy-and-data-isolation.md)                | Separate control plane and RLS-isolated shared tenant data plane | Proposed                                |
| [0003](0003-identity-authorization-and-support-access.md) | Identity, authorization, approvals and support access            | Proposed                                |
| [0004](0004-money-ledgers-and-corrections.md)             | Money, ledgers, posting and corrections                          | Proposed; finance/legal review required |
| [0005](0005-events-idempotency-and-jobs.md)               | Events, idempotency and asynchronous jobs                        | Proposed                                |
| [0006](0006-file-storage-and-document-verification.md)    | Files and public document verification                           | Proposed                                |
| [0007](0007-mobile-offline-sync.md)                       | Collector mobile offline synchronization                         | Proposed                                |
| [0008](0008-network-worker-and-routeros-safety.md)        | Network worker and RouterOS safety                               | Proposed; lab validation required       |
| [0009](0009-deployment-topologies-and-release.md)         | Deployment topologies and release strategy                       | Proposed                                |
| [0010](0010-observability-slos-and-data-safety.md)        | Observability, SLOs and telemetry safety                         | Proposed                                |

Each ADR must be traceable to [requirements](../requirements/requirements.md), risks,
implementation, tests, and operational evidence before the relevant phase gate closes.
