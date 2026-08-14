# OpenTelemetry signal and privacy contract

Status: instrumentation contract; runtime SDK wiring and staging validation remain open.
Requirements: PRD-OPS-005, PRD-NFR-001..004, PRD-BND-005.

## Correlation model

Propagate W3C Trace Context across HTTP, owning-database outbox, relay, queue and worker boundaries.
Use `request.id`, `job.id`, `event.id`, `deployment.id`, and `network.batch.id` only in logs/traces,
never metric labels. Tenant correlation uses an environment-keyed opaque value
`orvex.tenant.key = base64url(HMAC-SHA256(telemetry_key, canonical_tenant_id))`; do not export the
raw tenant UUID or a subscriber/customer identifier. Rotate the telemetry key by dual-emitting
versioned opaque keys only during a bounded migration and document lost cross-key continuity.

## Allowlist

| Signal                     | Allowed attributes                                                                                                         | Cardinality rule                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| All                        | `service.name`, `service.version`, `deployment.environment.name`, `cloud.region`, `orvex.plane`                            | bounded catalogue                                                   |
| HTTP trace/log             | `http.request.method`, normalized `http.route`, `http.response.status_code`, `error.type`, `request.id`, opaque tenant key | route template only; no URL/query                                   |
| DB trace                   | `db.system`, operation/relation allowlist, pool name, outcome, duration                                                    | no SQL text, bind values, connection string or database tenant name |
| Job/relay trace/log        | job/event type + schema version, queue name, attempt class, opaque job/event ID, oldest age                                | IDs prohibited from metrics                                         |
| Provider/network trace/log | adapter operation, safe provider code, opaque router key, outcome/uncertain state                                          | no endpoint, username, command arguments or response body           |
| Metrics                    | service/route template/status class/operation/queue/deployment profile/error class                                         | no IDs; target <10k active series/service until measured            |
| Logs                       | structured event code, severity, trace/span/request IDs, allowlisted outcome fields                                        | no free-form domain objects                                         |

Span names use low-cardinality templates such as `GET /v1/tenant/invoices/:invoiceId`,
`finance.payment.post`, `relay.operations_audit.deliver` and `network.command.reconcile`; never
embed an ID, name, phone, URL query or provider payload. Exception recording uses stable error class
and a sanitized message catalogue. Stack traces require access-controlled retention and a sentinel
scan.

## Forbidden everywhere

Authorization/cookie/CSRF/session/refresh tokens; passwords, PPPoE credentials, API keys and webhook
signatures; connection strings; subscriber/collector/staff names, phones, email, national IDs,
addresses or precise location; invoice/payment references supplied by a person/provider; free-form
notes; document/file contents or signed URLs; HTTP request/response bodies; SQL text/values; raw
RouterOS commands/responses; support attachments. Hashing low-entropy PII such as a phone number
does not make it safe.

## SDK and collector gates

- Application logging has a deny-by-default serializer and tested redaction before export. The
  Collector transform is defense in depth, not the primary boundary.
- Head sampling retains a bounded baseline; tail sampling may prioritize errors/high latency but
  must not inspect payload content. Finance/isolation audit remains in the domain audit store, not
  traces.
- Export is TLS-authenticated, bounded, batched and non-blocking. Telemetry failure cannot change a
  business transaction outcome. Local queues have disk/memory limits and a visible dropped-count.
- Metrics use histograms with reviewed buckets; no dynamic tenant/user/router labels.
  Tenant-specific views query an authorized aggregate store, not global high-cardinality labels.
- Central access is least privilege and audited; retention tiers and legal/export deletion behavior
  are accepted before production.

## Required verification

Seed unique sentinel strings shaped as every forbidden class, exercise success/validation/denial/
exception/provider/worker paths, then scan Collector input capture and every backend/export. Verify
zero matches, no raw bodies, bounded series, trace continuity through relay, exporter outage
behavior, and role restrictions. Any match is a critical release blocker and follows the
telemetry-leak runbook.
