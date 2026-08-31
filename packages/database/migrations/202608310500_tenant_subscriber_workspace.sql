-- PRD-CTL-005: auditable internal subscriber/service workspace. This creates no subscriber login.
CREATE FUNCTION audit_subscriber_workspace_read() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND OR context_row.action<>'tenant.subscriber.workspace.read'
    OR context_row.permission<>'tenant.subscriber.view' THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed subscriber workspace read is required';
  END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason
  ) VALUES(
    context_row.tenant_id,context_row.action,'subscriber_workspace',context_row.tenant_id::text,
    context_row.actor_id,context_row.session_id,context_row.support_grant_id,
    context_row.permission,context_row.request_id,context_row.idempotency_key,
    context_row.ip_address,context_row.user_agent,'allowed',context_row.reason
  );
END $$;
REVOKE ALL ON FUNCTION audit_subscriber_workspace_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_subscriber_workspace_read() TO orvex_runtime;

CREATE FUNCTION subscriber_workspace_readiness()
RETURNS TABLE(migration_ready boolean,function_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations
      WHERE name='202608310500_tenant_subscriber_workspace.sql'),
    to_regprocedure('public.audit_subscriber_workspace_read()') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION subscriber_workspace_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subscriber_workspace_readiness() TO orvex_runtime;
