-- orvex:database=tenant
-- Durable least-privilege queue for the RouterOS Network Worker.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orvex_network_worker') THEN
    RAISE EXCEPTION 'bootstrap required role orvex_network_worker before migration';
  END IF;
END $$;

CREATE SCHEMA network_worker AUTHORIZATION orvex_owner;
REVOKE ALL ON SCHEMA network_worker FROM PUBLIC;

CREATE TABLE network_worker.jobs (
  job_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  idempotency_key text NOT NULL,
  request jsonb NOT NULL,
  job jsonb NOT NULL,
  state text NOT NULL CHECK (state IN (
    'queued','running','retry_scheduled','reconciling','reconciled','succeeded',
    'partially_succeeded','failed','dead_lettered','canceled'
  )),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  UNIQUE (tenant_id,idempotency_key),
  CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  CHECK ((lease_owner IS NULL)=(lease_token IS NULL)),
  CHECK ((lease_owner IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX network_jobs_claim_idx ON network_worker.jobs(available_at,created_at,job_id)
  WHERE state IN ('queued','retry_scheduled','reconciling','running');

CREATE TABLE network_worker.routers (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  router_id text NOT NULL,
  endpoint text NOT NULL,
  credential_reference text NOT NULL CHECK (credential_reference ~ '^secret://[A-Za-z0-9/_-]{3,255}$'),
  connector text NOT NULL CHECK (connector IN ('routeros-api','routeros-rest','simulator')),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,router_id),
  CHECK (length(btrim(router_id)) BETWEEN 1 AND 128),
  CHECK (endpoint ~ '^https://')
);

-- Provisioned mapping between an Operations service and its RouterOS identity. Secrets remain
-- references; neither the API runtime nor this database stores RouterOS credential material.
CREATE TABLE network_worker.service_bindings (
  tenant_id uuid NOT NULL,
  service_id uuid NOT NULL,
  router_id text NOT NULL,
  account_name text NOT NULL,
  password_secret_reference text NOT NULL
    CHECK (password_secret_reference ~ '^secret://[A-Za-z0-9/_-]{3,255}$'),
  pool_id text,
  static_address text,
  vlan_id text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,service_id),
  FOREIGN KEY (tenant_id,service_id)
    REFERENCES public.operations_services(tenant_id,id),
  FOREIGN KEY (tenant_id,router_id)
    REFERENCES network_worker.routers(tenant_id,router_id),
  CHECK (length(btrim(account_name)) BETWEEN 1 AND 200),
  CHECK ((pool_id IS NOT NULL)::integer + (static_address IS NOT NULL)::integer = 1),
  CHECK (pool_id IS NULL OR length(btrim(pool_id)) BETWEEN 1 AND 128),
  CHECK (static_address IS NULL OR static_address ~ '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$'),
  CHECK (vlan_id IS NULL OR length(btrim(vlan_id)) BETWEEN 1 AND 128)
);

CREATE FUNCTION network_worker.enqueue_job(p_request jsonb,p_now timestamptz)
RETURNS TABLE(job jsonb) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,network_worker AS $$
DECLARE existing network_worker.jobs%ROWTYPE;
  new_id text := 'network-job-'||gen_random_uuid()::text;
  new_job jsonb;
BEGIN
  IF p_now IS NULL OR jsonb_typeof(p_request)<>'object'
    OR coalesce(p_request->>'tenantId','') !~ '^[0-9a-f-]{36}$'
    OR length(btrim(coalesce(p_request->>'idempotencyKey',''))) NOT BETWEEN 8 AND 200
    OR length(btrim(coalesce(p_request->>'requestId',''))) < 8
    OR length(btrim(coalesce(p_request->>'routerId',''))) < 1
    OR length(btrim(coalesce(p_request->>'subscriberServiceId',''))) < 1
    OR jsonb_typeof(p_request->'action')<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='N4000',MESSAGE='invalid network request';
  END IF;
  new_job:=jsonb_build_object(
    'jobId',new_id,'request',p_request,'createdAt',to_char(p_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'attempts','[]'::jsonb,'state','queued',
    'availableAt',to_char(p_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  INSERT INTO network_worker.jobs(job_id,tenant_id,idempotency_key,request,job,state,available_at,created_at)
  VALUES(new_id,(p_request->>'tenantId')::uuid,p_request->>'idempotencyKey',p_request,new_job,'queued',p_now,p_now)
  ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  SELECT * INTO existing FROM network_worker.jobs
    WHERE tenant_id=(p_request->>'tenantId')::uuid AND idempotency_key=p_request->>'idempotencyKey';
  IF existing.request<>p_request THEN
    RAISE EXCEPTION USING ERRCODE='N4090',MESSAGE='network idempotency key payload mismatch';
  END IF;
  RETURN QUERY SELECT existing.job;
END $$;

CREATE FUNCTION network_worker.claim_job(p_worker text,p_now timestamptz,p_lease_ms integer)
RETURNS TABLE(job jsonb,lease_token uuid) LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,network_worker AS $$
  WITH candidate AS (
    SELECT job_id FROM network_worker.jobs
    WHERE available_at<=p_now AND (
      state IN ('queued','retry_scheduled','reconciling') OR
      (state='running' AND lease_expires_at<=p_now)
    ) ORDER BY created_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE network_worker.jobs target SET
      state='running',job=jsonb_set(target.job,'{state}','"running"'::jsonb),
      lease_owner=p_worker,lease_token=gen_random_uuid(),
      lease_expires_at=p_now+make_interval(secs=>p_lease_ms::double precision/1000)
    FROM candidate WHERE target.job_id=candidate.job_id
      AND length(btrim(p_worker)) BETWEEN 1 AND 200 AND p_lease_ms BETWEEN 1000 AND 300000
    RETURNING target.job,target.lease_token
  ) SELECT claimed.job,claimed.lease_token FROM claimed
$$;

CREATE FUNCTION network_worker.save_job(p_worker text,p_lease_token uuid,p_job jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,network_worker AS $$
BEGIN
  IF jsonb_typeof(p_job)<>'object' OR p_job->>'state' NOT IN (
    'queued','running','retry_scheduled','reconciling','reconciled','succeeded',
    'partially_succeeded','failed','dead_lettered','canceled'
  ) THEN RAISE EXCEPTION USING ERRCODE='N4000',MESSAGE='invalid network job state'; END IF;
  UPDATE network_worker.jobs SET job=p_job,state=p_job->>'state',
    available_at=(p_job->>'availableAt')::timestamptz,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL
  WHERE job_id=p_job->>'jobId' AND lease_owner=p_worker AND lease_token=p_lease_token;
  RETURN FOUND;
END $$;

CREATE FUNCTION network_worker.get_job(p_job_id text)
RETURNS TABLE(job jsonb) LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,network_worker AS $$
  SELECT target.job FROM network_worker.jobs target WHERE target.job_id=p_job_id
$$;
CREATE FUNCTION network_worker.get_job_by_idempotency(p_tenant text,p_key text)
RETURNS TABLE(job jsonb) LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,network_worker AS $$
  SELECT target.job FROM network_worker.jobs target
  WHERE target.tenant_id=p_tenant::uuid AND target.idempotency_key=p_key
$$;
CREATE FUNCTION network_worker.list_dead_letters(p_limit integer)
RETURNS TABLE(job jsonb) LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,network_worker AS $$
  SELECT target.job FROM network_worker.jobs target WHERE target.state='dead_lettered'
  ORDER BY target.created_at LIMIT greatest(1,least(coalesce(p_limit,100),1000))
$$;

CREATE FUNCTION network_worker.register_router(
  p_tenant text,p_router text,p_endpoint text,p_secret text,p_connector text,p_enabled boolean
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,network_worker AS $$
  INSERT INTO network_worker.routers(tenant_id,router_id,endpoint,credential_reference,connector,enabled)
  VALUES(p_tenant::uuid,p_router,p_endpoint,p_secret,p_connector,p_enabled)
  ON CONFLICT(tenant_id,router_id) DO UPDATE SET endpoint=excluded.endpoint,
    credential_reference=excluded.credential_reference,connector=excluded.connector,
    enabled=excluded.enabled,updated_at=clock_timestamp()
$$;

CREATE FUNCTION network_worker.register_service_binding(
  p_tenant uuid,p_service uuid,p_router text,p_account text,p_password_secret text,
  p_pool text,p_static_address text,p_vlan text,p_enabled boolean
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,network_worker AS $$
  INSERT INTO network_worker.service_bindings(
    tenant_id,service_id,router_id,account_name,password_secret_reference,
    pool_id,static_address,vlan_id,enabled
  ) VALUES(
    p_tenant,p_service,p_router,p_account,p_password_secret,
    p_pool,p_static_address,p_vlan,p_enabled
  )
  ON CONFLICT(tenant_id,service_id) DO UPDATE SET
    router_id=excluded.router_id,account_name=excluded.account_name,
    password_secret_reference=excluded.password_secret_reference,pool_id=excluded.pool_id,
    static_address=excluded.static_address,vlan_id=excluded.vlan_id,
    enabled=excluded.enabled,updated_at=clock_timestamp()
$$;

-- Operations and Network Worker share the tenant database. This BEFORE trigger gives the
-- lifecycle command and durable job one atomic commit boundary. A missing/disabled binding or
-- profile fails closed instead of leaving an apparently queued action that can never execute.
CREATE FUNCTION network_worker.bridge_operations_network_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,network_worker AS $$
DECLARE
  binding network_worker.service_bindings%ROWTYPE;
  service public.operations_services%ROWTYPE;
  profile_reference text;
  context_row public.operations_request_contexts%ROWTYPE;
  desired jsonb;
  action jsonb;
  request jsonb;
BEGIN
  SELECT * INTO binding FROM network_worker.service_bindings
  WHERE tenant_id=NEW.tenant_id AND service_id=NEW.service_id FOR SHARE;
  SELECT * INTO service FROM public.operations_services
  WHERE tenant_id=NEW.tenant_id AND id=NEW.service_id FOR SHARE;
  SELECT * INTO context_row FROM public.operations_current_context();
  IF NOT FOUND OR context_row.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='authorized network request context is missing';
  END IF;
  IF binding.service_id IS NULL OR NOT binding.enabled THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='subscriber service has no active network binding';
  END IF;
  SELECT plan.network_profile_reference INTO profile_reference
  FROM public.operations_plans plan
  WHERE plan.tenant_id=service.tenant_id AND plan.id=service.plan_id;
  IF NEW.action='change_profile' THEN profile_reference:=NEW.payload->>'profileReference'; END IF;
  IF nullif(btrim(coalesce(profile_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='subscriber service has no network profile';
  END IF;

  desired:=jsonb_build_object(
    'accountName',binding.account_name,
    'enabled',NEW.action NOT IN ('suspend','terminate'),
    'profileId',profile_reference,
    'ipAssignment',CASE WHEN binding.pool_id IS NOT NULL
      THEN jsonb_build_object('mode','dynamic','poolId',binding.pool_id)
      ELSE jsonb_build_object('mode','static','address',binding.static_address) END
  ) || CASE WHEN binding.vlan_id IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('vlanId',binding.vlan_id) END;
  action:=CASE NEW.action
    WHEN 'activate' THEN jsonb_build_object(
      'kind','pppoe.create','desired',desired,
      'passwordSecretReference',binding.password_secret_reference)
    WHEN 'restore' THEN jsonb_build_object('kind','pppoe.restore','desired',desired)
    WHEN 'change_profile' THEN jsonb_build_object('kind','pppoe.profile.change','desired',desired)
    ELSE jsonb_build_object('kind','pppoe.suspend','desired',desired)
  END;
  request:=jsonb_build_object(
    'requestId',context_row.request_id,
    'idempotencyKey',NEW.idempotency_key,
    'tenantId',NEW.tenant_id,
    'routerId',binding.router_id,
    'subscriberServiceId',NEW.service_id,
    'action',action,
    'origin','tenant-service-lifecycle',
    'actorId',context_row.actor_id,
    'permission',context_row.permission,
    'reason',context_row.reason
  );
  PERFORM network_worker.enqueue_job(request,clock_timestamp());
  NEW.delivered_at:=clock_timestamp();
  NEW.last_error:=NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER operations_network_action_to_worker
BEFORE INSERT ON public.operations_network_action_outbox
FOR EACH ROW EXECUTE FUNCTION network_worker.bridge_operations_network_action();
CREATE FUNCTION network_worker.get_router(p_tenant text,p_router text)
RETURNS TABLE(router_id text,tenant_id text,endpoint text,credential_reference text,connector text,enabled boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,network_worker AS $$
  SELECT target.router_id,target.tenant_id::text,target.endpoint,target.credential_reference,
    target.connector,target.enabled FROM network_worker.routers target
  WHERE target.tenant_id=p_tenant::uuid AND target.router_id=p_router
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA network_worker FROM PUBLIC,orvex_runtime,orvex_network_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA network_worker FROM PUBLIC,orvex_runtime;
GRANT USAGE ON SCHEMA network_worker TO orvex_network_worker;
GRANT EXECUTE ON FUNCTION
  network_worker.enqueue_job(jsonb,timestamptz),
  network_worker.claim_job(text,timestamptz,integer),
  network_worker.save_job(text,uuid,jsonb),
  network_worker.get_job(text),
  network_worker.get_job_by_idempotency(text,text),
  network_worker.list_dead_letters(integer),
  network_worker.get_router(text,text)
TO orvex_network_worker;
-- Router registration is an explicit DBA/provisioning action, never a worker capability.
REVOKE ALL ON FUNCTION network_worker.register_router(text,text,text,text,text,boolean)
  FROM PUBLIC,orvex_runtime,orvex_network_worker;
REVOKE ALL ON FUNCTION network_worker.register_service_binding(uuid,uuid,text,text,text,text,text,text,boolean)
  FROM PUBLIC,orvex_runtime,orvex_network_worker;
REVOKE ALL ON FUNCTION network_worker.bridge_operations_network_action()
  FROM PUBLIC,orvex_runtime,orvex_network_worker;
