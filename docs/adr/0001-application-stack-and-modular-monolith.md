# ADR-0001: Application stack and modular monolith

- Status: Proposed
- Date: 2026-08-09
- Deciders: Architecture, Backend, Web, Mobile, SRE
- Requirements: PRD-BND-006, PRD-API-001, PRD-OPS-001..004, PRD-NFR-\*

## Context

The product has broad financial, tenancy, mobile, deployment and network domains, but starts with an
empty repository and one delivery team. Premature business microservices would add distributed
transactions, versioned deployment and operations cost before scale evidence. Router communication
and heavy async work do require failure/security isolation.

## Decision

Use the pinned Node/npm workspaces already established by the secure vertical slice. Use
React/Vite/TypeScript for the authenticated platform and tenant web apps, React Native with Expo
development builds/TypeScript for mobile, and Fastify/TypeScript in `apps/api`. Use framework-free
rules in `packages/domain`, Zod/OpenAPI contracts in `packages/contracts`, and explicit PostgreSQL
schema/repositories through Drizzle in `packages/database`. Use PostgreSQL, Redis-compatible
production-supported queue/cache/locks, S3-compatible object storage and containerized
local/production environments.

This deliberately differs from the prompt's Laravel/Next reference: one TypeScript toolchain lets
this team share validated contracts/types and security primitives across API, web and mobile,
removes a second package/runtime supply chain, and the authenticated operational apps do not need
Next server rendering/SEO. Fastify supplies a mature, low-overhead HTTP/plugin boundary while
Drizzle keeps SQL/RLS/migrations visible for security review. These benefits are material only if
framework-free domain boundaries and database integration tests prevent TypeScript package coupling
from becoming a monolith without structure.

Keep control and tenant bounded contexts in `apps/api` with transport → application → domain →
infrastructure dependency direction. Do not expose Drizzle models as API/domain models. Run RouterOS
communication in isolated `workers` processes; allow document/export/scanning jobs to use separate
process/queue pools. These are deployable isolation/scaling boundaries, not permission to duplicate
domain ownership.

Exact versions are pinned in toolchain files/lockfiles only after official stable/LTS verification
and compatibility builds. Renovation is scheduled: patch security updates promptly, minor updates
through CI/staging, majors through compatibility ADR/release plan.

## Consequences

- One main API release and cohesive transactions within one owning database simplify correctness.
- Web/mobile share contracts/i18n/value schemas but not server-only domain or repository logic.
- A single runtime reduces bootstrap cost but increases the blast radius of ecosystem/runtime
  vulnerabilities; lockfile, SCA, container scanning and dependency review are release gates.
- A module can become a service only with measured independent scale/failure/security need and a new
  ADR defining data ownership and operational cost.

## Rejected alternatives

- Laravel/Next reference stack: mature and viable, but rejected for this build because it adds
  PHP/Composer and server-rendering complexity while the working vertical slice, shared contract
  pipeline and team repository are already TypeScript. Reconsider if staffing or missing framework
  capabilities produce measured risk.
- Microservices per domain: rejected for initial complexity and distributed correctness risk.
- Single web app with role toggles: rejected because vendor control and tenant surfaces have
  different trust/audience boundaries.
- Kubernetes by default: rejected absent measured orchestration need; containers/IaC remain
  portable.

## Validation

Clean bootstrap/build/test for all workspaces; architecture dependency tests; OpenAPI
generated-client contract; local Compose smoke; one vertical slice identity → tenant → policy →
audit in EN/AR; network worker isolated at network and code dependency levels.
