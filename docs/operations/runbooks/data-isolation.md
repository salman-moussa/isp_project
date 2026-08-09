# Suspected tenant data-isolation incident

Treat any credible signal as SEV-1 until disproved.

1. Preserve request/trace/audit IDs, actor/session/support token, source/target tenant pseudonyms,
   route/job/object/key and timestamps. Do not reproduce broadly or paste raw records.
2. Revoke implicated session/support token and disable the narrow route, worker consumer, export or
   signed object path. If scope is unknown, place affected boundary in safe read-only/maintenance
   mode; do not erase caches/logs/evidence.
3. Check tenant resolution, permission decision, database role/connection, queue envelope,
   Redis/object/realtime/export/backup namespaces and recent code/config/migration changes.
4. Query immutable audit/access evidence to determine data exposed or changed, actors, duration and
   tenants. Use approved security access and preserve chain of custody.
5. Patch and test the exact boundary plus adjacent boundaries with valid cross-tenant fixtures.
   Rotate compromised tokens/credentials and repair unauthorized mutations through auditable domain
   corrections, never silent edits.
6. Restore gradually after independent security review, negative isolation tests and monitoring.
   Leadership/counsel owns tenant notification decisions.

Record confirmed versus potential exposure separately. Absence of application logs is not proof of
no access.
