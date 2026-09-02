-- REQ-NET-001: terminal non-order jobs must persist without entering order synchronization.
CREATE OR REPLACE FUNCTION sync_sales_order_network_job(p_job jsonb) RETURNS void
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
  IF jsonb_typeof(request_value)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='N4000',MESSAGE='invalid network result request';
  END IF;
  -- Only accepted-order PPP creation results synchronize the sales task. Every other valid
  -- network job must still be allowed to persist its own terminal state.
  IF request_value->>'origin'<>'tenant-service-lifecycle'
    OR request_value->'action'->>'kind'<>'pppoe.create' THEN RETURN; END IF;
  IF coalesce(request_value->>'tenantId','') !~ '^[0-9a-f-]{36}$'
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
