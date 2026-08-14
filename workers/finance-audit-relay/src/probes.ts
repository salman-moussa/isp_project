import type { createDatabase } from '@isp/database';

type DatabaseClient = ReturnType<typeof createDatabase>['client'];

interface CapabilityRow extends Record<string, unknown> {
  readonly relation_exists: boolean;
  readonly required_columns_exist: boolean;
  readonly schema_usage: boolean;
  readonly can_select: boolean;
  readonly can_insert: boolean;
  readonly marker_exists: boolean;
  readonly can_execute_marker: boolean;
  readonly discovery_exists: boolean;
  readonly can_execute_discovery: boolean;
  readonly operations_ready: boolean;
  readonly subscription_state_ready: boolean;
}

export async function probeControlRelayCapability(client: DatabaseClient): Promise<void> {
  const [row] = await client.unsafe<CapabilityRow[]>(`
    SELECT
      to_regclass('public.audit_events') IS NOT NULL AS relation_exists,
      (
        SELECT count(*) = 8
        FROM pg_catalog.pg_attribute
        WHERE attrelid = to_regclass('public.audit_events')
          AND attname IN (
            'actor_reference', 'session_reference', 'support_grant_reference',
            'permission', 'request_id', 'request_reference', 'action', 'metadata'
          )
          AND NOT attisdropped
      ) AS required_columns_exist,
      has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
      has_table_privilege(current_user, 'public.audit_events', 'SELECT') AS can_select,
      has_table_privilege(current_user, 'public.audit_events', 'INSERT') AS can_insert,
      true AS marker_exists,
      true AS can_execute_marker,
      true AS discovery_exists,
      true AS can_execute_discovery,
      to_regclass('public.control_center_subscription_state_outbox') IS NOT NULL
        AND has_function_privilege(current_user,
          'public.list_control_subscription_state_relay_tenants()','EXECUTE')
        AND has_function_privilege(current_user,
          'public.read_control_subscription_state_outbox(uuid,integer)','EXECUTE')
        AND has_function_privilege(current_user,
          'public.read_control_subscription_state_backlog(uuid)','EXECUTE')
        AND has_function_privilege(current_user,
          'public.mark_control_subscription_state_delivered(uuid,timestamp with time zone)','EXECUTE')
        AS subscription_state_ready,
      true AS operations_ready
  `);
  assertCapability(row, false);
}

export async function probeTenantRelayCapability(client: DatabaseClient): Promise<void> {
  const [row] = await client.unsafe<CapabilityRow[]>(`
    SELECT
      to_regclass('public.finance_audit_outbox') IS NOT NULL AS relation_exists,
      (
        SELECT count(*) = 6
        FROM pg_catalog.pg_attribute
        WHERE attrelid = to_regclass('public.finance_audit_outbox')
          AND attname IN (
            'tenant_id', 'event_id', 'delivered_at', 'request_id', 'occurred_at', 'client_posted_at'
          )
          AND NOT attisdropped
      ) AS required_columns_exist,
      has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
      has_table_privilege(current_user, 'public.finance_audit_outbox', 'SELECT') AS can_select,
      false AS can_insert,
      to_regprocedure(
        'public.mark_finance_audit_outbox_delivered(uuid,timestamp with time zone)'
      ) IS NOT NULL AS marker_exists,
      has_function_privilege(
        current_user,
        'public.mark_finance_audit_outbox_delivered(uuid,timestamp with time zone)',
        'EXECUTE'
      ) AS can_execute_marker,
      to_regprocedure('public.list_finance_audit_relay_tenants()') IS NOT NULL
        AS discovery_exists,
      has_function_privilege(
        current_user,
        'public.list_finance_audit_relay_tenants()',
        'EXECUTE'
      ) AS can_execute_discovery,
      to_regclass('public.operations_audit_outbox') IS NOT NULL
        AND has_function_privilege(current_user,
          'public.list_operations_audit_relay_tenants()','EXECUTE')
        AND has_function_privilege(current_user,
          'public.read_operations_audit_outbox(uuid,integer)','EXECUTE')
        AND has_function_privilege(current_user,
          'public.read_operations_audit_backlog(uuid)','EXECUTE')
        AND has_function_privilege(current_user,
          'public.mark_operations_audit_outbox_delivered(uuid,timestamp with time zone)','EXECUTE')
        AS operations_ready,
      to_regclass('public.operations_platform_subscription_events') IS NOT NULL
        AND has_function_privilege(current_user,
          'public.record_operations_platform_subscription_state(uuid,uuid,text,bigint,timestamp with time zone)','EXECUTE')
        AS subscription_state_ready
  `);
  assertCapability(row, true);
}

function assertCapability(row: CapabilityRow | undefined, tenantPlane: boolean): void {
  if (
    !row?.relation_exists ||
    !row.required_columns_exist ||
    !row.schema_usage ||
    !row.can_select ||
    (!tenantPlane && !row.can_insert) ||
    !row.operations_ready ||
    !row.subscription_state_ready ||
    (tenantPlane &&
      (!row.marker_exists ||
        !row.can_execute_marker ||
        !row.discovery_exists ||
        !row.can_execute_discovery))
  ) {
    throw new Error('Finance audit relay database capability is unavailable.');
  }
}
