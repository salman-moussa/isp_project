# Incident management

## Severity and roles

- **SEV-1:** confirmed/suspected tenant isolation, financial integrity, credential compromise with
  active risk, unrecoverable data loss, or widespread unsafe network action.
- **SEV-2:** major outage/degradation, backup failure threatening RPO, contained security event, or
  critical workflow unavailable without safe workaround.
- **SEV-3:** limited degradation with a safe workaround. **SEV-4:** routine defect/request.

Assign incident commander, operations lead, domain/security lead as applicable, communications lead
and scribe. The commander coordinates; responders announce potentially destructive actions and use
peer confirmation.

## Universal sequence

1. Acknowledge, open a restricted incident record, set severity/roles, use UTC, preserve
   alert/trace/request/release IDs.
2. Protect people, tenant data and financial/network integrity. Stop or feature-disable only the
   smallest unsafe pathway; do not mass-disconnect subscribers.
3. Establish scope and last known-good state from read-only evidence. Never expose PII/secrets in
   the incident channel.
4. Contain with reversible actions, record exact commands/approvers/results, and preserve forensic
   evidence and chain of custody.
5. Recover through the relevant runbook; use readiness, isolation, balance and smoke checks before
   traffic or job replay.
6. Communicate at the agreed cadence with facts, impact, actions, risks and next update—no
   unsupported cause or recovery promises.
7. Close after monitoring and business validation. Within the agreed window, conduct a blameless
   review with timeline, root/contributing causes, control gaps, owners and dates.

Legal/privacy notification decisions require authorized leadership and qualified counsel; responders
do not speculate. Never delete evidence, rotate keys before capturing necessary metadata, or
restore/rollback databases blindly.
