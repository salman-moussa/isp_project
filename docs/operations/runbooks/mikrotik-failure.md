# MikroTik connector failure runbook

1. Identify tenant/router/job/batch scope, desired state, last known actual state and failure class:
   validation, auth, unreachable, timeout, known reject, partial, uncertain or rate limit. Never
   copy router credentials/config exports into tickets.
2. Stop only the affected router/batch/command type if risk exists. Platform subscription
   restriction is never a reason to enqueue subscriber actions.
3. For known failure, correct configuration/authorization and use bounded retry. For
   timeout/uncertain/partial outcome, query/reconcile actual router state before retry; blind retry
   is forbidden.
4. Check connector identity/secret reference, allowed egress, DNS/time, queue age/attempts, circuit
   breaker, router capacity and recent adapter/release changes. Rotate credentials only through the
   compromise procedure if exposure is suspected.
5. Preview remediation impact and require step-up/dual approval for configured bulk/high-risk
   actions. Record actor, reason, target set, before/desired/actual state, attempts and result.
6. Resume gradually, monitor latency/failure/uncertain rate and reconcile every job in the affected
   window.

If control is unsafe or state cannot be established, leave jobs paused and use documented
tenant-operated manual recovery. Do not claim success from worker completion without
desired-versus-actual verification.
