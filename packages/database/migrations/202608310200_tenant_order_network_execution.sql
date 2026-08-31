-- Complete an accepted order's network task only from a terminal, durable Network Worker result.
CREATE FUNCTION sync_sales_order_network_job(p_job jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,network_worker AS $$
DECLARE
  request_value jsonb:=p_job->'request';
  job_state text:=p_job->>'state';
  target_tenant uuid;
  target_actor uuid;
  target_service uuid;
BEGIN
  IF session_user<>'orvex_network_worker' THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='network worker identity is required';
  END IF;
  IF job_state NOT IN (
    'reconciled','succeeded','partially_succeeded','failed','dead_lettered','canceled'
  ) THEN RETURN; END IF;
  IF jsonb_typeof(request_value)<>'object'
    OR request_value->>'origin'<>'tenant-service-lifecycle'
    OR request_value->'action'->>'kind'<>'pppoe.create'
    OR coalesce(request_value->>'tenantId','') !~ '^[0-9a-f-]{36}$'
    OR coalesce(request_value->>'actorId','') !~ '^[0-9a-f-]{36}$'
    OR coalesce(request_value->>'subscriberServiceId','') !~ '^[0-9a-f-]{36}$'
    OR length(btrim(coalesce(p_job->>'jobId',''))) < 8 THEN
    RAISE EXCEPTION USING ERRCODE='N4000',MESSAGE='invalid order network result';
  END IF;
  target_tenant:=(request_value->>'tenantId')::uuid;
  target_actor:=(request_value->>'actorId')::uuid;
  target_service:=(request_value->>'subscriberServiceId')::uuid;

  DELETE FROM operations_request_contexts
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
  INSERT INTO operations_request_contexts(
    backend_pid,transaction_id,tenant_id,actor_id,session_id,support_grant_id,
    permission,action,request_id,ip_address,user_agent,reason,idempotency_key,
    branch_ids,area_ids,route_ids,record_ids,expires_at
  ) VALUES(
    pg_backend_pid(),txid_current(),target_tenant,target_actor::text,
    'network-worker:'||(p_job->>'jobId'),NULL,'tenant.network.job.create',
    'tenant.network.job.complete','network-result:'||(p_job->>'jobId'),'network-worker',
    'Orvex Network Worker','Durable router result synchronized to accepted service order',
    'network-result:'||(p_job->>'jobId'),NULL,NULL,NULL,NULL,clock_timestamp()+interval '5 minutes'
  );

  IF job_state IN ('reconciled','succeeded') THEN
    UPDATE sales_order_tasks task SET status='completed',last_error=NULL,completed_by=target_actor,
      result_reference=coalesce(task.result_reference,'{}'::jsonb)||jsonb_build_object(
        'networkJobId',p_job->>'jobId','networkJobState',job_state,
        'networkAttempts',coalesce(p_job->'attempts','[]'::jsonb)
      )
    WHERE task.tenant_id=target_tenant AND task.task_key='network_activation'
      AND task.status='running'
      AND task.result_reference->>'serviceId'=target_service::text
      AND EXISTS(
        SELECT 1 FROM operations_network_action_outbox action_outbox
        WHERE action_outbox.tenant_id=task.tenant_id
          AND action_outbox.id::text=task.result_reference->>'outboxId'
          AND action_outbox.service_id=target_service
          AND action_outbox.action='activate'
          AND action_outbox.idempotency_key=request_value->>'idempotencyKey'
      );
    IF FOUND THEN
      UPDATE sales_order_tasks billing_task SET status='ready',last_error=NULL
      WHERE billing_task.tenant_id=target_tenant AND billing_task.task_key='first_billing'
        AND billing_task.status='pending'
        AND EXISTS(
          SELECT 1 FROM sales_order_tasks network_task
          WHERE network_task.tenant_id=billing_task.tenant_id
            AND network_task.order_id=billing_task.order_id
            AND network_task.task_key='network_activation' AND network_task.status='completed'
        );
    END IF;
  ELSE
    UPDATE sales_order_tasks task SET status='failed',
      last_error='Network Worker terminal state: '||job_state||
        coalesce(' ('||nullif(p_job->>'lastErrorClass','')||')',''),
      result_reference=coalesce(task.result_reference,'{}'::jsonb)||jsonb_build_object(
        'networkJobId',p_job->>'jobId','networkJobState',job_state,
        'networkAttempts',coalesce(p_job->'attempts','[]'::jsonb)
      )
    WHERE task.tenant_id=target_tenant AND task.task_key='network_activation'
      AND task.status='running' AND task.result_reference->>'serviceId'=target_service::text
      AND EXISTS(
        SELECT 1 FROM operations_network_action_outbox action_outbox
        WHERE action_outbox.tenant_id=task.tenant_id
          AND action_outbox.id::text=task.result_reference->>'outboxId'
          AND action_outbox.service_id=target_service
          AND action_outbox.action='activate'
          AND action_outbox.idempotency_key=request_value->>'idempotencyKey'
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION network_worker.save_job(p_worker text,p_lease_token uuid,p_job jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,network_worker AS $$
DECLARE saved boolean;
BEGIN
  IF jsonb_typeof(p_job)<>'object' OR p_job->>'state' NOT IN (
    'queued','running','retry_scheduled','reconciling','reconciled','succeeded',
    'partially_succeeded','failed','dead_lettered','canceled'
  ) THEN RAISE EXCEPTION USING ERRCODE='N4000',MESSAGE='invalid network job state'; END IF;
  UPDATE network_worker.jobs SET job=p_job,state=p_job->>'state',
    available_at=(p_job->>'availableAt')::timestamptz,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL
  WHERE job_id=p_job->>'jobId' AND lease_owner=p_worker AND lease_token=p_lease_token
    AND request=p_job->'request';
  saved:=FOUND;
  IF saved THEN PERFORM public.sync_sales_order_network_job(p_job); END IF;
  RETURN saved;
END $$;

CREATE OR REPLACE FUNCTION append_sales_audit_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE context_row operations_request_contexts%ROWTYPE; row_value jsonb; row_id text;
BEGIN
  SELECT * INTO context_row FROM operations_current_context();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed sales context is required'; END IF;
  row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  row_id:=row_value->>'id';
  IF (row_value->>'tenant_id')::uuid<>context_row.tenant_id OR row_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='sales audit context does not match mutation';
  END IF;
  IF NOT (
    (TG_TABLE_NAME='sales_leads' AND context_row.action='tenant.sales.lead.create' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_qualifications') AND context_row.action='tenant.sales.qualify' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME='sales_offer_versions' AND context_row.action='tenant.catalog.offer.version.create' AND context_row.permission='tenant.catalog.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes') AND context_row.action='tenant.sales.quote.create' AND context_row.permission='tenant.sales.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes') AND context_row.action='tenant.sales.quote.approve' AND context_row.permission='tenant.catalog.manage')
    OR (TG_TABLE_NAME IN ('sales_leads','sales_quotes','sales_service_orders','sales_order_tasks') AND context_row.action='tenant.sales.quote.accept' AND context_row.permission='tenant.order.manage')
    OR (TG_TABLE_NAME IN ('sales_service_orders','sales_order_tasks') AND context_row.action='tenant.subscriber.create' AND context_row.permission='tenant.subscriber.create')
    OR (TG_TABLE_NAME='sales_order_tasks' AND context_row.action='tenant.resource.reserve' AND context_row.permission='tenant.network.job.create')
    OR (TG_TABLE_NAME='sales_order_tasks' AND context_row.action IN ('tenant.service.installation.create','tenant.installation.transition') AND context_row.permission='tenant.installation.manage')
    OR (TG_TABLE_NAME='sales_order_tasks' AND context_row.action IN ('tenant.network.job.create','tenant.network.job.complete') AND context_row.permission='tenant.network.job.create')
  ) THEN RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize sales mutation'; END IF;
  INSERT INTO operations_audit_outbox(
    tenant_id,action,resource_type,resource_id,actor_id,session_id,support_grant_id,
    permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value
  ) VALUES(
    context_row.tenant_id,context_row.action,TG_TABLE_NAME,row_id,context_row.actor_id,
    context_row.session_id,context_row.support_grant_id,context_row.permission,context_row.request_id,
    context_row.idempotency_key,context_row.ip_address,context_row.user_agent,'allowed',context_row.reason,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE FUNCTION sales_network_execution_readiness()
RETURNS TABLE(migration_ready boolean,sync_ready boolean,worker_bridge_ready boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public AS $$
  SELECT
    EXISTS(SELECT 1 FROM _orvex_migrations WHERE name='202608310200_tenant_order_network_execution.sql'),
    to_regprocedure('public.sync_sales_order_network_job(jsonb)') IS NOT NULL,
    to_regprocedure('network_worker.save_job(text,uuid,jsonb)') IS NOT NULL
$$;

REVOKE ALL ON FUNCTION sync_sales_order_network_job(jsonb),sales_network_execution_readiness()
  FROM PUBLIC,orvex_runtime,orvex_network_worker;
GRANT EXECUTE ON FUNCTION sales_network_execution_readiness() TO orvex_runtime;
