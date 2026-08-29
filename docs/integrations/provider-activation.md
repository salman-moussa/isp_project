# Provider framework and activation

Status: Phase F provider contract implementation. Requirement IDs: REQ-INT-001 through REQ-INT-004.

The `@isp/providers` package defines typed configuration, provider health, feature flags, activation
checklists, retry/circuit/dead-letter behavior, signed webhook verification, and fake/manual
adapters. It performs no external calls and contains no private or guessed API endpoint.

## Safe configuration placeholders

Values ending in `_REFERENCE` are secret-manager references such as
`secret://tenants/example/providers/omt/api-key`; they are not credentials. Add these names to the
deployment environment only when composing the package:

| Provider               | Safe mode   | Activation placeholders                                                                                  |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| OMT                    | `manual`    | `OMT_PROVIDER_MODE`, `OMT_API_BASE_URL`, `OMT_API_KEY_REFERENCE`, `OMT_WEBHOOK_SECRET_REFERENCE`         |
| Whish                  | `manual`    | `WHISH_PROVIDER_MODE`, `WHISH_API_BASE_URL`, `WHISH_API_KEY_REFERENCE`, `WHISH_WEBHOOK_SECRET_REFERENCE` |
| POS                    | `fake`      | `POS_PROVIDER_MODE`, `POS_API_BASE_URL`, `POS_API_KEY_REFERENCE`                                         |
| Online payment         | `fake`      | `ONLINE_PAYMENT_PROVIDER_MODE`, `ONLINE_PAYMENT_API_BASE_URL`, `ONLINE_PAYMENT_API_KEY_REFERENCE`        |
| Bank import            | `fake`      | `BANK_IMPORT_PROVIDER_MODE`, `BANK_IMPORT_FORMAT`                                                        |
| Maps                   | `fake`      | `MAPS_PROVIDER_MODE`, `MAPS_API_KEY_REFERENCE`                                                           |
| Bluetooth printer      | `fake`      | `BLUETOOTH_PRINTER_MODE`                                                                                 |
| Object storage/scanner | `fake`      | `OBJECT_STORAGE_MODE`, `OBJECT_STORAGE_CREDENTIAL_REFERENCE`, `MALWARE_SCANNER_MODE`                     |
| Email/OTP              | `fake`      | `EMAIL_PROVIDER_MODE`, `EMAIL_API_KEY_REFERENCE`, `OTP_PROVIDER_MODE`                                    |
| WhatsApp               | `deep_link` | `WHATSAPP_SHARING_MODE` (manual user-initiated share only)                                               |
| DNS/SSL                | `fake`      | `DNS_PROVIDER_MODE`, `DNS_API_KEY_REFERENCE`, `SSL_PROVIDER_MODE`                                        |

Configuration objects are checked for plaintext secret-shaped keys. Live endpoints require HTTPS,
and live mode requires at least one valid secret reference. Secret values must be fetched only at
the call boundary and must not be returned through provider results.

## OMT and Whish activation

OMT and Whish are deliberately manual-first. Staff record the external reference, amount/currency,
timestamp, and proof attachment, then an authorized reviewer verifies it. Live verification remains
blocked until all of the following are available and approved:

1. A signed official provider contract and documented permitted use.
2. Current official API and webhook documentation obtained from the provider.
3. Sandbox and production credentials stored in the secret manager.
4. Documented signature algorithm, timestamp tolerance, event identifier, retry behavior, rate
   limits, IP/egress requirements, and settlement report format.
5. Verified idempotency and duplicate-event behavior in the sandbox.
6. Finance-approved settlement/reconciliation, refund, reversal, and incident procedures.
7. Security review, contract tests, failure injection, metrics, alerts, rollback, and
   feature-flagged activation per tenant.

Do not construct a live adapter until those inputs exist. The same rule applies to a configurable
POS or online provider.

## Webhooks

Provider-specific ingress must preserve the exact request bytes. `verifyAndClaimWebhook` validates
an HMAC-SHA-256 signature over `timestamp + "." + rawBody` with constant-time comparison, rejects
stale timestamps, and atomically claims `(providerId, eventId)` in a replay store. A production
replay store must be durable and unique at the database layer. Store the verified event before
business processing; acknowledge according to the provider contract; process idempotently; retain
safe failure/dead-letter visibility. Never log raw bodies if they may contain personal, payment, or
authentication data.

The HMAC framing in the shared fake is a test contract, not a claim about any provider's signing
scheme. A live adapter must implement and test the official scheme without weakening timestamp or
replay protection.

## Staff invitation delivery contract

Production authentication delivery must expose `POST /v1/staff-invitations/messages` behind the
configured `AUTH_DELIVERY_BASE_URL`. Orvex authenticates with the configured bearer token and sends
`invitationId`, `tenantId`, `email`, `displayName`, the opaque one-time `token`, and `expiresAt`.
The provider must construct the browser link as `https://isp.mosesgr.com/#/staff-invitation/{token}`
(or the approved deployment origin), deliver it only to the supplied staff address, and return a
successful 2xx response only after durable provider acceptance.

The token is credential material: never place it in query parameters, logs, analytics, exception
messages, delivery receipts, or support tooling. Provider request/response logging must redact the
token and authorization header. Enforce HTTPS, expiry, bounded retry, idempotency by `invitationId`,
and delivery-status observability that contains no token. Live delivery remains
`activation_required` until the provider contract, credentials, templates, sandbox receipt, failure
handling, and production acceptance are supplied. Development delivery is deliberately inert and
does not print tokens.

## Adapter-specific activation checks

- POS/online: tokenization boundary, supported currencies, settlement, charge/refund lifecycle,
  idempotency, webhooks, dispute process, and PCI scope.
- Bank: approved statement schema, encoding/timezone, deduplication key, account masking, correction
  handling, and reconciliation ownership.
- Maps: data-processing terms, Lebanese address precision, quotas, retention, and manual
  coordinates.
- Printer: supported ESC/POS profile, Arabic shaping/code page, paper widths, reconnect,
  duplicate-print warning, and device testing. A print failure must not roll back a posted payment.
- Storage/scanner: bucket isolation, encryption, signed-URL TTL, object-size/type limits,
  quarantine, scanner update health, and infected-file incident path.
- Email/OTP: staff-only authentication/document use, expiry, attempt limits, rate limits,
  anti-enumeration, message templates, and delivery/failure webhooks. There is no subscriber login.
- WhatsApp: manual deep link only unless an approved Business Messaging contract exists. The user
  must initiate sending; links must not become a portal or push-notification system.
- DNS/SSL: zone ownership, exact preview/approval, least privilege, propagation checks, certificate
  renewal alerts, rollback, and a manual checklist fallback.

## Composition hooks

The application composition owner should add `@isp/providers` to package build/validation, persist
durable webhook events/dead letters/idempotency, expose health and activation state without secret
values, wire per-tenant feature flags, and keep each workload in a dedicated queue. Fake adapters
are for local/CI only; deployment must reject `fake` mode when a tenant is marked production-live.
