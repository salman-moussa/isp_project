# ADR-0007: Collector mobile offline synchronization

- Status: Proposed
- Date: 2026-08-09
- Deciders: Mobile, Finance, Security, Architecture
- Requirements: PRD-MOB-001..010, PRD-FIN-001/005/007/010
- Risks: RSK-002, RSK-007, RSK-008

## Context

Collectors must complete a day with unreliable connectivity, print locally and reconcile without
lost/duplicate payment. Device data can be stolen/stale; local time and snapshots are not
authoritative. Mobile networks reorder/repeat requests.

## Decision

Use an encrypted local relational database with keys in OS secure storage, device authorization and
policy-bound session. Bootstrap/delta sync provides minimal assigned Subscriber/route snapshots with
scope/version/expiry. Server authorizes every synced operation against current policy; possession of
a snapshot grants no server rights.

A user action first commits draft, immutable outbox operation and optional local receipt in one
encrypted transaction, then reports local success. Each operation has cryptographic local UUID,
authorized device, server-issued tenant/assignment context, type/schema, exact decimal/currency,
dependency references, local occurred time, payload hash, attempt/status and canonical result
mapping. Dependent operations preserve order; independent operations batch with count/size limits.

Server reserves the operation ID/idempotency key transactionally with posting. Duplicate same
payload returns prior canonical result; mismatched payload conflicts. Outcomes are accepted,
retryable, rejected or classified conflict. Posted finance is never auto-merged/overwritten.
Resolution creates a new explicit operation and retains the superseded evidence.

Local receipt numbers use device/day/sequence plus UUID-derived verification and are labeled
provisional until sync; canonical receipt mapping is retained. Printer failure cannot affect
local/server payment. Device clock is evidence only; server posting/recorded time is canonical.
Revocation blocks refresh/bootstrap/sync; unsynced data follows an auditable incident recovery
workflow rather than silent deletion.

## Consequences

- Sync/state UI is a core workflow, not background magic.
- Schema migration, key recovery, storage pressure and stale assignment policy require explicit
  testing/runbooks.
- Provisional/canonical receipt presentation needs finance/product approval.
- Remote revocation and offline continuity have an unavoidable policy trade-off captured in
  DEC-007/ASM-009.

## Rejected alternatives

- Network request then local save: loses work on disconnect/process death.
- Last-write-wins: corrupts finance and assignments.
- Server-only receipt number before collection: fails offline and encourages unsafe number
  reservation.
- Treat device clock as posting order: manipulable/skewed.

## Validation

Process kill at each transaction/sync step; eight-hour offline day; duplicate/reorder/concurrent
devices; assignment change, expired/revoked device, clock skew, local DB migration/storage full,
wrong currency/reference, proof later upload, print fail/disconnect/reprint, conflict resolution and
end-of-day reconciliation with zero lost/duplicate accepted payment.
