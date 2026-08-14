# Orvex ISP Collect reference implementation

Status: production-oriented reference core; not approved for a store or tenant production rollout.

Requirements: PRD-MOB-001..010, PRD-FIN-001/005/007/010, ADR-0007, T5.1..T5.6.

## Delivered boundary

`apps/collect` is an isolated Android-first Expo workspace. Its reference UI is bilingual English /
Arabic, switches layout direction, shows connection/queue/conflict status persistently, lists only
assigned route records, forces explicit USD/LBP and method selection, labels provisional receipts,
keeps print failure recoverable, and exposes end-of-day reconciliation. The default composition is
clearly labeled reference mode and has no backend or real provider.

The framework-independent core defines:

- device registration and MFA-backed session handles; token plaintext belongs in an OS credential
  vault and is represented locally only by `tokenHandle`;
- a production AES-256-GCM state driver using Expo Crypto, an OS SecureStore-protected device key,
  authenticated schema context, and recoverable temp/current/backup replacement; `none` is rejected
  in every environment and there is deliberately no AsyncStorage/plaintext fallback;
- an atomic state transaction containing local payment, provisional receipt identity, and immutable
  ordered outbox operation before local success is returned;
- exact integer minor units with explicit USD/LBP and payment method. Currency totals are never
  combined;
- dependency-ordered sync with operation ID/idempotency key, payload hash, checkpoint, retryable,
  accepted, rejected, and recoverable conflict states;
- remote revoke/reauth locking. Pending evidence is retained for an audited recovery process and is
  never silently deleted or uploaded after revocation;
- device time as evidence only. Durable local sequence orders sync, and server-recorded time is the
  only canonical posting order;
- printer operations behind an adapter. Print/disconnect failure appends an audit operation and
  cannot roll back or remove a payment;
- reconciliation drafts and submissions separated by currency and method, including denomination,
  handover/proof references, discrepancy note, and manager-approval requirement.

The focused test matrix covers online acceptance, offline retry, process restart, duplicate replay,
payload/assignment conflict, revocation, clock skew, printer disconnect, assignment scope, explicit
currency, and durable/idempotent reconciliation.

## Required backend integration hooks

The tenant backend owner must provide versioned contracts before removing reference mode:

1. `POST /v1/collect/devices/authorize` — OTP/MFA authorization that returns a device-bound session
   and opaque secure-token material. Device status is checked for every following request.
2. `GET /v1/collect/bootstrap` and `GET /v1/collect/deltas?checkpoint=…` — minimal assigned route
   and subscriber snapshots only, with assignment context version, cache expiry, and server
   checkpoint.
3. `POST /v1/collect/sync` — accepts bounded ordered operations. The server reserves
   `(tenant_id, device_id, operation_id)` with the payload hash transactionally with finance
   posting; a same-payload duplicate returns its original canonical result and a changed payload
   conflicts.
4. Payment sync must return canonical payment/receipt references and server-recorded time. It must
   authorize current collector assignment and currency/allocation rather than trusting cached data.
5. Conflict responses must contain only safe facts and permitted resolution actions. A correction is
   a new linked operation; posted finance is never overwritten.
6. `POST /v1/collect/reconciliations` must preserve USD/LBP and method lines, make submission
   idempotent, and leave discrepancy approval/closure to an independently authorized manager.
7. Revoke/refresh endpoints must stop bootstrap, deltas, sync, and assignment fetch. An audited
   incident endpoint is required to recover retained unsynced evidence from a revoked device.

The mobile composition includes concrete `ExpoSecureDeviceKeyVault` and `ExpoAesGcmStateDriver`
adapters. It still needs production composition for a cryptographic SHA-256 `PayloadHasher`,
authenticated `CollectSyncEndpoint`, and an approved Bluetooth `ReceiptPrinter`. Fakes remain the
default for tests.

## Production and app-store blockers

The following external decisions/credentials are intentionally absent and block a production claim:

- an Expo/EAS organization and replacement of `REPLACE_WITH_EAS_PROJECT_ID`;
- Android signing/upload keys, Google Play Console application, package-name approval, store
  listing, privacy disclosures, data-safety form, support URL, and deletion/retention policy;
- production API URL, certificate/public-key pin rotation policy, OAuth/OTP issuer configuration,
  device attestation/MDM/root policy, session/offline-cache lifetime, and incident recovery owner;
- OS SecureStore key lifecycle, backup exclusion, migration, storage-full, uninstall/reinstall,
  stolen-device, key-loss, and AES-GCM file-recovery validation on the supported Android matrix;
- approved Bluetooth printer models/protocols, Android permission rationale, receipt paper format,
  Arabic glyph/RTL printer verification, disconnect/reconnect lab tests, and finance/legal sign-off
  on provisional/canonical receipt wording;
- approved map deep-link providers and permission copy. Continuous background employee tracking is
  explicitly out of scope;
- independent Mobile Security, Finance, Accessibility/Arabic, QA eight-hour offline soak, and Play
  pre-launch reviews.

There are no database migrations or deployment changes in this mobile-only tranche. Rollback is to
stop distributing the unapproved mobile artifact; locally retained financial evidence must follow
the audited recovery procedure and must not be erased as a rollback mechanism.

## Observability and privacy contract

Telemetry may include operation type, opaque operation/device references, sync state, bounded
attempt counts, latency, printer outcome code, storage pressure class, and redacted crash metadata.
It must never include subscriber names, phone/address, amount notes, proof content, token material,
database keys, OTP values, or printer payloads. Location opens an explicit map deep link only; no
background location history is collected.
