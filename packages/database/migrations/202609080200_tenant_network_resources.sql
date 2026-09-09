-- Network resources: governed router registry, service bindings, durable job control, IPAM
-- pools with an address allocation ledger, NAS clients, CPE registry and a RADIUS accounting
-- ingest boundary. Every mutation is a signed, exact-replayable command with bilingual evidence.

CREATE TABLE operations_network_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  actor_id text NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) >= 8),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  reason_en text NOT NULL,
  reason_ar text NOT NULL,
  evidence text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (NOT operations_json_contains_secret_key(request_payload))
);
CREATE INDEX operations_network_events_resource_idx
  ON operations_network_events(tenant_id, resource_type, resource_id, occurred_at DESC);
CREATE TRIGGER network_event_immutable BEFORE UPDATE OR DELETE ON operations_network_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER network_event_no_truncate BEFORE TRUNCATE ON operations_network_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();

ALTER TABLE operations_ip_pools
  ADD COLUMN purpose text NOT NULL DEFAULT 'pppoe_dynamic'
    CHECK (purpose IN ('pppoe_dynamic','static_public','cgnat','management','infrastructure')),
  ADD COLUMN description text,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT operations_ip_pools_tenant_identity UNIQUE (tenant_id, id);

CREATE TABLE operations_ip_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  pool_id uuid NOT NULL,
  address inet NOT NULL,
  kind text NOT NULL CHECK (kind IN ('service','reserved','gateway','infrastructure')),
  service_id uuid,
  label text,
  status text NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated','released')),
  allocated_by text NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  release_reason text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, pool_id) REFERENCES operations_ip_pools(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  CHECK ((kind = 'service') = (service_id IS NOT NULL)),
  CHECK ((status = 'released') = (released_at IS NOT NULL)),
  CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX operations_ip_allocations_live_address_idx
  ON operations_ip_allocations(tenant_id, address) WHERE status = 'allocated';
CREATE INDEX operations_ip_allocations_pool_idx
  ON operations_ip_allocations(tenant_id, pool_id, status);
CREATE TRIGGER ip_allocation_no_delete BEFORE DELETE ON operations_ip_allocations
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

ALTER TABLE operations_nas_clients
  ADD COLUMN description text,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT operations_nas_clients_tenant_identity UNIQUE (tenant_id, id),
  ADD CONSTRAINT operations_nas_clients_secret_reference_check
    CHECK (secret_reference ~ '^secret://[A-Za-z0-9/_-]{3,255}$');

ALTER TABLE operations_cpe_devices
  ADD COLUMN model text,
  ADD COLUMN service_id uuid,
  ADD COLUMN asset_id uuid,
  ADD COLUMN notes text,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT operations_cpe_devices_tenant_identity UNIQUE (tenant_id, id),
  ADD CONSTRAINT operations_cpe_devices_service_fk
    FOREIGN KEY (tenant_id, service_id) REFERENCES operations_services(tenant_id, id),
  ADD CONSTRAINT operations_cpe_devices_asset_fk
    FOREIGN KEY (tenant_id, asset_id) REFERENCES operations_serialized_assets(tenant_id, id);
CREATE UNIQUE INDEX operations_cpe_devices_service_idx
  ON operations_cpe_devices(tenant_id, service_id) WHERE service_id IS NOT NULL;

ALTER TABLE operations_radius_sessions
  ADD COLUMN nas_ip_address inet,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE operations_network_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_network_events FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_ip_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_ip_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_network_events ON operations_network_events
  USING (tenant_id = (operations_current_context()).tenant_id);
CREATE POLICY tenant_isolation_ip_allocations ON operations_ip_allocations
  USING (tenant_id = (operations_current_context()).tenant_id);
REVOKE ALL ON operations_network_events, operations_ip_allocations FROM PUBLIC, orvex_runtime;
GRANT SELECT ON operations_network_events, operations_ip_allocations, operations_ip_pools,
  operations_nas_clients, operations_cpe_devices, operations_radius_sessions TO orvex_runtime;

-- Context guard shared by every network read and command.
CREATE FUNCTION network_context_or_raise(required_actions text[], allowed_permissions text[])
RETURNS operations_request_contexts LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public AS $$
DECLARE c operations_request_contexts%ROWTYPE; BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
   OR NOT (c.permission = ANY(allowed_permissions)) OR NOT (c.action = ANY(required_actions)) THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='signed network authority required';
 END IF;
 RETURN c;
END $$;
REVOKE ALL ON FUNCTION network_context_or_raise(text[], text[]) FROM PUBLIC;

CREATE FUNCTION read_network_routers() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public, network_worker AS $$
DECLARE c operations_request_contexts%ROWTYPE; BEGIN
 c := network_context_or_raise(ARRAY['tenant.network.workspace.read'],
   ARRAY['tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve']);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'routerId', r.router_id, 'endpoint', r.endpoint, 'credentialReference', r.credential_reference,
   'connector', r.connector, 'enabled', r.enabled, 'updatedAt', r.updated_at,
   'boundServices', (SELECT count(*) FROM network_worker.service_bindings b
     WHERE b.tenant_id = r.tenant_id AND b.router_id = r.router_id AND b.enabled),
   'openJobs', (SELECT count(*) FROM network_worker.jobs j WHERE j.tenant_id = r.tenant_id
     AND j.request->>'routerId' = r.router_id AND j.state IN ('queued','running','retry_scheduled','reconciling'))
   ) ORDER BY r.router_id) FROM network_worker.routers r WHERE r.tenant_id = c.tenant_id), '[]'::jsonb);
END $$;

CREATE FUNCTION read_network_bindings() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public, network_worker AS $$
DECLARE c operations_request_contexts%ROWTYPE; BEGIN
 c := network_context_or_raise(ARRAY['tenant.network.workspace.read'],
   ARRAY['tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve']);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'serviceId', b.service_id, 'serviceNumber', s.service_number, 'serviceStatus', s.status,
   'subscriberName', u.display_name, 'routerId', b.router_id, 'accountName', b.account_name,
   'passwordSecretReference', b.password_secret_reference, 'poolId', b.pool_id,
   'staticAddress', b.static_address, 'vlanId', b.vlan_id, 'enabled', b.enabled, 'updatedAt', b.updated_at
   ) ORDER BY s.service_number)
   FROM network_worker.service_bindings b
   JOIN operations_services s ON s.tenant_id = b.tenant_id AND s.id = b.service_id
   JOIN operations_subscribers u ON u.tenant_id = s.tenant_id AND u.id = s.subscriber_id
   WHERE b.tenant_id = c.tenant_id
     AND operations_scope_allows(s.tenant_id, s.branch_id, s.area_id, s.route_id, s.id)), '[]'::jsonb);
END $$;

CREATE FUNCTION read_network_jobs(p_scope text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public, network_worker AS $$
DECLARE c operations_request_contexts%ROWTYPE; BEGIN
 c := network_context_or_raise(ARRAY['tenant.network.workspace.read'],
   ARRAY['tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve']);
 RETURN coalesce((SELECT jsonb_agg(row_value) FROM (
   SELECT jsonb_build_object(
     'jobId', j.job_id, 'state', j.state, 'kind', j.request->'action'->>'kind',
     'origin', j.request->>'origin', 'routerId', j.request->>'routerId',
     'serviceId', j.request->>'subscriberServiceId', 'serviceNumber', s.service_number,
     'subscriberName', u.display_name, 'actorId', j.request->>'actorId', 'reason', j.request->>'reason',
     'attempts', jsonb_array_length(coalesce(j.job->'attempts','[]'::jsonb)),
     'previousAttempts', jsonb_array_length(coalesce(j.job->'previousAttempts','[]'::jsonb)),
     'lastErrorClass', j.job->>'lastErrorClass',
     'lastOutcome', (j.job->'attempts')->-1->'outcome',
     'createdAt', j.created_at, 'availableAt', j.available_at, 'leaseOwner', j.lease_owner) AS row_value
   FROM network_worker.jobs j
   LEFT JOIN operations_services s ON s.tenant_id = j.tenant_id AND s.id::text = j.request->>'subscriberServiceId'
   LEFT JOIN operations_subscribers u ON u.tenant_id = s.tenant_id AND u.id = s.subscriber_id
   WHERE j.tenant_id = c.tenant_id
     -- A job that names a service is visible only where that service is in the reader's scope;
     -- a service row hidden by row security must not surface its job.
     AND (nullif(j.request->>'subscriberServiceId','') IS NULL
       OR (s.id IS NOT NULL AND operations_scope_allows(s.tenant_id, s.branch_id, s.area_id, s.route_id, s.id)))
     AND (p_scope = 'all'
       OR (p_scope = 'open' AND j.state IN ('queued','running','retry_scheduled','reconciling'))
       OR (p_scope = 'attention' AND j.state IN ('failed','dead_lettered','partially_succeeded'))
       OR (p_scope = 'closed' AND j.state IN ('reconciled','succeeded','canceled')))
   ORDER BY CASE WHEN j.state IN ('failed','dead_lettered') THEN 0 WHEN j.state IN ('queued','running','retry_scheduled','reconciling') THEN 1 ELSE 2 END,
     j.created_at DESC, j.job_id
   LIMIT greatest(1, least(coalesce(p_limit, 100), 500))) job_rows), '[]'::jsonb);
END $$;

-- Utilization for IPv4 pools; IPv6 reports allocations only (host counts are not meaningful).
CREATE FUNCTION network_pool_utilization(p_tenant uuid, p_pool uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'usable', CASE WHEN family(p.subnet_cidr::cidr) = 4 AND masklen(p.subnet_cidr::cidr) <= 30
      THEN (2::numeric ^ (32 - masklen(p.subnet_cidr::cidr)))::bigint - 2
      WHEN family(p.subnet_cidr::cidr) = 4 THEN (2::numeric ^ (32 - masklen(p.subnet_cidr::cidr)))::bigint ELSE NULL END,
    'allocated', (SELECT count(*) FROM operations_ip_allocations a
      WHERE a.tenant_id = p.tenant_id AND a.pool_id = p.id AND a.status = 'allocated'))
  FROM operations_ip_pools p WHERE p.tenant_id = p_tenant AND p.id = p_pool
$$;
REVOKE ALL ON FUNCTION network_pool_utilization(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION network_pool_utilization(uuid, uuid) TO orvex_runtime;

CREATE FUNCTION execute_network_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, network_worker AS $$
#variable_conflict use_variable
DECLARE c operations_request_contexts%ROWTYPE; prior operations_network_events%ROWTYPE;
 action text; answer jsonb; before_value jsonb; resource_type text; resource_id text;
 pool operations_ip_pools%ROWTYPE; alloc operations_ip_allocations%ROWTYPE; nas operations_nas_clients%ROWTYPE;
 cpe operations_cpe_devices%ROWTYPE; svc operations_services%ROWTYPE; router network_worker.routers%ROWTYPE;
 binding network_worker.service_bindings%ROWTYPE; job network_worker.jobs%ROWTYPE;
 subnet cidr; candidate inet; gateway inet; hosts bigint; expected integer;
BEGIN
 action := payload->>'action';
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
   OR c.permission NOT IN ('tenant.network.job.create','tenant.network.bulk.approve') THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='signed network authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='complete bilingual network evidence is required';
 END IF;
 IF operations_json_contains_secret_key(payload) THEN
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='network commands carry secret references, never secret values';
 END IF;
 -- Infrastructure (routers, NAS) needs the bulk-approval authority and its own signed action;
 -- resources (pools, addresses, bindings, CPE, job control) use the job authority.
 IF action IN ('register_router','update_router','upsert_nas_client') THEN
  IF c.action <> 'tenant.network.infrastructure.manage' OR c.permission <> 'tenant.network.bulk.approve' THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='network infrastructure changes need the approval authority';
  END IF;
 ELSIF action IN ('create_ip_pool','update_ip_pool','reserve_address','release_address','allocate_service_address',
   'bind_service','register_cpe','update_cpe','cancel_job','retry_job') THEN
  IF c.action <> 'tenant.network.resource.manage' THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='the signed network action does not cover this command';
  END IF;
 ELSE
  RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown network command';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':network:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_network_events WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='network retry key belongs to different content';
  END IF;
  RETURN prior.result || jsonb_build_object('replayed', true);
 END IF;

 CASE action
 WHEN 'register_router', 'update_router' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','routerId','endpoint','routerAccessReference','connector','enabled','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown router field'; END IF;
  SELECT * INTO router FROM network_worker.routers WHERE tenant_id=c.tenant_id AND router_id=payload->>'routerId' FOR UPDATE;
  IF action='register_router' AND FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='router id already registered'; END IF;
  IF action='update_router' AND NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='router is not registered'; END IF;
  before_value := CASE WHEN router.router_id IS NULL THEN NULL ELSE to_jsonb(router) END;
  PERFORM network_worker.register_router(c.tenant_id::text, payload->>'routerId', payload->>'endpoint',
    payload->>'routerAccessReference', payload->>'connector', coalesce((payload->>'enabled')::boolean, true));
  SELECT * INTO router FROM network_worker.routers WHERE tenant_id=c.tenant_id AND router_id=payload->>'routerId';
  resource_type := 'network_router'; resource_id := router.router_id;
  answer := jsonb_build_object('routerId', router.router_id, 'enabled', router.enabled, 'connector', router.connector);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(router));

 WHEN 'upsert_nas_client' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','nasClientId','expectedVersion','nasName','ipAddress','nasKeyReference','nasType','description','active','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown NAS field'; END IF;
  IF nullif(payload->>'nasClientId','') IS NOT NULL THEN
   SELECT * INTO nas FROM operations_nas_clients WHERE tenant_id=c.tenant_id AND id=(payload->>'nasClientId')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='NAS client not found'; END IF;
   IF nas.version <> (payload->>'expectedVersion')::integer THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='NAS client changed; refresh before saving'; END IF;
   before_value := to_jsonb(nas);
   UPDATE operations_nas_clients SET nas_name=btrim(payload->>'nasName'), ip_address=(payload->>'ipAddress')::inet,
     secret_reference=payload->>'nasKeyReference', nas_type=coalesce(payload->>'nasType','mikrotik'),
     description=nullif(btrim(payload->>'description'),''), active=coalesce((payload->>'active')::boolean,true),
     version=version+1, updated_at=clock_timestamp()
    WHERE tenant_id=c.tenant_id AND id=nas.id RETURNING * INTO nas;
  ELSE
   INSERT INTO operations_nas_clients(tenant_id,nas_name,ip_address,secret_reference,nas_type,description,active)
   VALUES(c.tenant_id,btrim(payload->>'nasName'),(payload->>'ipAddress')::inet,payload->>'nasKeyReference',
     coalesce(payload->>'nasType','mikrotik'),nullif(btrim(payload->>'description'),''),coalesce((payload->>'active')::boolean,true))
   RETURNING * INTO nas;
  END IF;
  resource_type := 'operations_nas_clients'; resource_id := nas.id::text;
  answer := jsonb_build_object('nasClientId', nas.id, 'version', nas.version, 'active', nas.active);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(nas));

 WHEN 'create_ip_pool', 'update_ip_pool' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','poolId','expectedVersion','poolName','subnetCidr','gateway','vlanId','purpose','description','active','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown pool field'; END IF;
  subnet := (payload->>'subnetCidr')::cidr;
  IF nullif(payload->>'gateway','') IS NOT NULL AND NOT ((payload->>'gateway')::inet << subnet) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='the gateway must lie inside the pool subnet'; END IF;
  IF action='create_ip_pool' THEN
   IF EXISTS(SELECT 1 FROM operations_ip_pools p WHERE p.tenant_id=c.tenant_id AND p.active
       AND (p.subnet_cidr::cidr && subnet)) THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='the subnet overlaps an active pool'; END IF;
   INSERT INTO operations_ip_pools(tenant_id,pool_name,subnet_cidr,ip_version,gateway,vlan_id,purpose,description,active)
   VALUES(c.tenant_id,btrim(payload->>'poolName'),text(subnet),CASE WHEN family(subnet)=6 THEN 'v6' ELSE 'v4' END,
     nullif(payload->>'gateway','')::inet,nullif(payload->>'vlanId','')::integer,coalesce(payload->>'purpose','pppoe_dynamic'),
     nullif(btrim(payload->>'description'),''),coalesce((payload->>'active')::boolean,true))
   RETURNING * INTO pool;
  ELSE
   SELECT * INTO pool FROM operations_ip_pools WHERE tenant_id=c.tenant_id AND id=(payload->>'poolId')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='pool not found'; END IF;
   IF pool.version <> (payload->>'expectedVersion')::integer THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='pool changed; refresh before saving'; END IF;
   IF text(subnet) <> pool.subnet_cidr AND EXISTS(SELECT 1 FROM operations_ip_allocations a
       WHERE a.tenant_id=c.tenant_id AND a.pool_id=pool.id AND a.status='allocated' AND NOT (a.address << subnet)) THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='live allocations fall outside the new subnet'; END IF;
   IF EXISTS(SELECT 1 FROM operations_ip_pools p WHERE p.tenant_id=c.tenant_id AND p.active AND p.id<>pool.id
       AND (p.subnet_cidr::cidr && subnet)) AND coalesce((payload->>'active')::boolean,true) THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='the subnet overlaps an active pool'; END IF;
   before_value := to_jsonb(pool);
   UPDATE operations_ip_pools SET pool_name=btrim(payload->>'poolName'), subnet_cidr=text(subnet),
     ip_version=CASE WHEN family(subnet)=6 THEN 'v6' ELSE 'v4' END, gateway=nullif(payload->>'gateway','')::inet,
     vlan_id=nullif(payload->>'vlanId','')::integer, purpose=coalesce(payload->>'purpose',purpose),
     description=nullif(btrim(payload->>'description'),''), active=coalesce((payload->>'active')::boolean,true),
     version=version+1, updated_at=clock_timestamp()
    WHERE tenant_id=c.tenant_id AND id=pool.id RETURNING * INTO pool;
  END IF;
  resource_type := 'operations_ip_pools'; resource_id := pool.id::text;
  answer := jsonb_build_object('poolId', pool.id, 'version', pool.version, 'subnetCidr', pool.subnet_cidr)
    || network_pool_utilization(c.tenant_id, pool.id);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(pool));

 WHEN 'reserve_address', 'allocate_service_address' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','poolId','address','kind','serviceId','label','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown allocation field'; END IF;
  SELECT * INTO pool FROM operations_ip_pools WHERE tenant_id=c.tenant_id AND id=(payload->>'poolId')::uuid AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='pool not found or inactive'; END IF;
  subnet := pool.subnet_cidr::cidr;
  IF action='allocate_service_address' THEN
   SELECT * INTO svc FROM operations_services WHERE tenant_id=c.tenant_id AND id=(payload->>'serviceId')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='service is outside the current scope'; END IF;
   IF EXISTS(SELECT 1 FROM operations_ip_allocations a WHERE a.tenant_id=c.tenant_id AND a.service_id=svc.id AND a.status='allocated') THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='the service already holds a live address'; END IF;
  END IF;
  IF nullif(payload->>'address','') IS NOT NULL THEN
   candidate := (payload->>'address')::inet;
   IF NOT (candidate << subnet) THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='address is outside the pool'; END IF;
  ELSE
   IF family(subnet) <> 4 OR masklen(subnet) < 16 THEN
    RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='automatic allocation needs an IPv4 pool of /16 or smaller'; END IF;
   hosts := (2::numeric ^ (32 - masklen(subnet)))::bigint;
   gateway := pool.gateway;
   SELECT probe INTO candidate FROM (
     SELECT (host(network(subnet))::inet + n) AS probe FROM generate_series(1, hosts - 2) n) probes
    WHERE (gateway IS NULL OR probe <> gateway)
      AND NOT EXISTS (SELECT 1 FROM operations_ip_allocations a WHERE a.tenant_id=c.tenant_id AND a.address=probe AND a.status='allocated')
    ORDER BY probe LIMIT 1;
   IF candidate IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='the pool has no free address'; END IF;
  END IF;
  INSERT INTO operations_ip_allocations(tenant_id,pool_id,address,kind,service_id,label,allocated_by)
  VALUES(c.tenant_id,pool.id,candidate,CASE WHEN action='allocate_service_address' THEN 'service' ELSE coalesce(payload->>'kind','reserved') END,
    CASE WHEN action='allocate_service_address' THEN svc.id ELSE NULL END,nullif(btrim(payload->>'label'),''),c.actor_id)
  RETURNING * INTO alloc;
  resource_type := 'operations_ip_allocations'; resource_id := alloc.id::text;
  answer := jsonb_build_object('allocationId', alloc.id, 'address', host(alloc.address), 'poolId', pool.id, 'kind', alloc.kind)
    || network_pool_utilization(c.tenant_id, pool.id);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,NULL,to_jsonb(alloc));

 WHEN 'release_address' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action','allocationId','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown release field'; END IF;
  SELECT * INTO alloc FROM operations_ip_allocations WHERE tenant_id=c.tenant_id AND id=(payload->>'allocationId')::uuid FOR UPDATE;
  IF NOT FOUND OR alloc.status <> 'allocated' THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='allocation is not live'; END IF;
  IF alloc.service_id IS NOT NULL AND EXISTS(SELECT 1 FROM network_worker.service_bindings b
      WHERE b.tenant_id=c.tenant_id AND b.service_id=alloc.service_id AND b.enabled AND b.static_address=host(alloc.address)) THEN
   RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='an enabled binding still uses this address'; END IF;
  before_value := to_jsonb(alloc);
  UPDATE operations_ip_allocations SET status='released', released_at=clock_timestamp(), release_reason=btrim(payload->>'reasonEn')
   WHERE tenant_id=c.tenant_id AND id=alloc.id RETURNING * INTO alloc;
  resource_type := 'operations_ip_allocations'; resource_id := alloc.id::text;
  answer := jsonb_build_object('allocationId', alloc.id, 'address', host(alloc.address), 'status', alloc.status)
    || network_pool_utilization(c.tenant_id, alloc.pool_id);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(alloc));

 WHEN 'bind_service' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','serviceId','routerId','accountName','pppAccessReference','poolId','staticAddress','vlanId','enabled','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown binding field'; END IF;
  SELECT * INTO svc FROM operations_services WHERE tenant_id=c.tenant_id AND id=(payload->>'serviceId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='service is outside the current scope'; END IF;
  SELECT * INTO router FROM network_worker.routers WHERE tenant_id=c.tenant_id AND router_id=payload->>'routerId';
  IF NOT FOUND OR NOT router.enabled THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='router is not registered or disabled'; END IF;
  IF (nullif(payload->>'poolId','') IS NULL) = (nullif(payload->>'staticAddress','') IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='choose either a dynamic pool or a static address'; END IF;
  IF nullif(payload->>'staticAddress','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_ip_allocations a
      WHERE a.tenant_id=c.tenant_id AND a.service_id=svc.id AND a.status='allocated' AND host(a.address)=payload->>'staticAddress') THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='the static address must be allocated to this service first'; END IF;
  SELECT * INTO binding FROM network_worker.service_bindings WHERE tenant_id=c.tenant_id AND service_id=svc.id;
  before_value := CASE WHEN binding.service_id IS NULL THEN NULL ELSE to_jsonb(binding) END;
  PERFORM network_worker.register_service_binding(c.tenant_id, svc.id, payload->>'routerId', btrim(payload->>'accountName'),
    payload->>'pppAccessReference', nullif(payload->>'poolId',''), nullif(payload->>'staticAddress',''),
    nullif(payload->>'vlanId',''), coalesce((payload->>'enabled')::boolean, true));
  SELECT * INTO binding FROM network_worker.service_bindings WHERE tenant_id=c.tenant_id AND service_id=svc.id;
  resource_type := 'network_service_binding'; resource_id := svc.id::text;
  answer := jsonb_build_object('serviceId', svc.id, 'routerId', binding.router_id, 'accountName', binding.account_name, 'enabled', binding.enabled);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(binding));

 WHEN 'register_cpe', 'update_cpe' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','cpeId','expectedVersion','serialNumber','model','oui','tr069DeviceId','serviceId','assetId','notes','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown CPE field'; END IF;
  IF nullif(payload->>'serviceId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_services s
      WHERE s.tenant_id=c.tenant_id AND s.id=(payload->>'serviceId')::uuid) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='service is outside the current scope'; END IF;
  IF nullif(payload->>'assetId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_serialized_assets a
      WHERE a.tenant_id=c.tenant_id AND a.id=(payload->>'assetId')::uuid) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='serialized asset is outside the current scope'; END IF;
  IF action='register_cpe' THEN
   INSERT INTO operations_cpe_devices(tenant_id,serial_number,model,oui,tr069_device_id,service_id,asset_id,notes)
   VALUES(c.tenant_id,btrim(payload->>'serialNumber'),nullif(btrim(payload->>'model'),''),nullif(btrim(payload->>'oui'),''),
     nullif(btrim(payload->>'tr069DeviceId'),''),nullif(payload->>'serviceId','')::uuid,nullif(payload->>'assetId','')::uuid,
     nullif(btrim(payload->>'notes'),''))
   RETURNING * INTO cpe;
  ELSE
   SELECT * INTO cpe FROM operations_cpe_devices WHERE tenant_id=c.tenant_id AND id=(payload->>'cpeId')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='CPE not found'; END IF;
   IF cpe.version <> (payload->>'expectedVersion')::integer THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='CPE changed; refresh before saving'; END IF;
   before_value := to_jsonb(cpe);
   -- Fields absent from the payload keep their value; an explicit empty string clears one.
   UPDATE operations_cpe_devices SET
     model=CASE WHEN payload ? 'model' THEN nullif(btrim(payload->>'model'),'') ELSE cpe.model END,
     oui=CASE WHEN payload ? 'oui' THEN nullif(btrim(payload->>'oui'),'') ELSE cpe.oui END,
     tr069_device_id=CASE WHEN payload ? 'tr069DeviceId' THEN nullif(btrim(payload->>'tr069DeviceId'),'') ELSE cpe.tr069_device_id END,
     service_id=CASE WHEN payload ? 'serviceId' THEN nullif(payload->>'serviceId','')::uuid ELSE cpe.service_id END,
     asset_id=CASE WHEN payload ? 'assetId' THEN nullif(payload->>'assetId','')::uuid ELSE cpe.asset_id END,
     notes=CASE WHEN payload ? 'notes' THEN nullif(btrim(payload->>'notes'),'') ELSE cpe.notes END,
     version=version+1, updated_at=clock_timestamp()
    WHERE tenant_id=c.tenant_id AND id=cpe.id RETURNING * INTO cpe;
  END IF;
  resource_type := 'operations_cpe_devices'; resource_id := cpe.id::text;
  answer := jsonb_build_object('cpeId', cpe.id, 'version', cpe.version, 'serviceId', cpe.service_id, 'status', cpe.status);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(cpe));

 WHEN 'cancel_job', 'retry_job' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('action','jobId','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='unknown job control field'; END IF;
  SELECT * INTO job FROM network_worker.jobs WHERE tenant_id=c.tenant_id AND job_id=payload->>'jobId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4001', MESSAGE='network job not found'; END IF;
  IF EXISTS(SELECT 1 FROM operations_services s WHERE s.tenant_id=c.tenant_id AND s.id::text=job.request->>'subscriberServiceId')
    AND NOT EXISTS(SELECT 1 FROM operations_services s WHERE s.tenant_id=c.tenant_id AND s.id::text=job.request->>'subscriberServiceId'
      AND operations_scope_allows(s.tenant_id, s.branch_id, s.area_id, s.route_id, s.id)) THEN
   RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='network job is outside the current scope'; END IF;
  before_value := jsonb_build_object('state', job.state, 'attempts', jsonb_array_length(coalesce(job.job->'attempts','[]'::jsonb)));
  IF action='cancel_job' THEN
   IF job.state NOT IN ('queued','retry_scheduled') THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='only queued or retry-scheduled jobs can be cancelled'; END IF;
   UPDATE network_worker.jobs SET state='canceled', job=jsonb_set(jobs.job,'{state}','"canceled"'::jsonb),
     lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL
    WHERE job_id=job.job_id RETURNING * INTO job;
  ELSE
   IF c.permission <> 'tenant.network.bulk.approve' THEN
    RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='re-queuing a dead-lettered job needs the approval authority'; END IF;
   IF job.state NOT IN ('failed','dead_lettered') THEN
    RAISE EXCEPTION USING ERRCODE='P4091', MESSAGE='only failed or dead-lettered jobs can be retried'; END IF;
   -- Attempt history is preserved under previousAttempts so the retry budget starts fresh.
   UPDATE network_worker.jobs SET state='queued', available_at=clock_timestamp(),
     job=(jobs.job - 'lastErrorClass') || jsonb_build_object('state','queued',
       'availableAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'attempts','[]'::jsonb,
       'previousAttempts',coalesce(jobs.job->'previousAttempts','[]'::jsonb) || coalesce(jobs.job->'attempts','[]'::jsonb),
       'manualRetries',coalesce((jobs.job->>'manualRetries')::integer,0)+1),
     lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL
    WHERE job_id=job.job_id RETURNING * INTO job;
  END IF;
  resource_type := 'network_job'; resource_id := job.job_id;
  answer := jsonb_build_object('jobId', job.job_id, 'state', job.state);
  INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,permission,
    request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
  VALUES(c.tenant_id,c.action,resource_type,resource_id,c.actor_id,c.session_id,c.permission,c.request_id,
    c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,jsonb_build_object('state', job.state));
 END CASE;

 INSERT INTO operations_network_events(tenant_id,action,resource_type,resource_id,actor_id,session_id,request_id,
   idempotency_key,request_payload,result,reason_en,reason_ar,evidence)
 VALUES(c.tenant_id,action,resource_type,resource_id,c.actor_id,c.session_id,c.request_id,c.idempotency_key,payload,
   answer,btrim(payload->>'reasonEn'),btrim(payload->>'reasonAr'),btrim(payload->>'evidence'));
 RETURN answer || jsonb_build_object('replayed', false);
END $$;

-- RADIUS accounting ingest for the Network Worker / RADIUS relay identity. Start, interim and
-- stop records upsert one session per NAS accounting id; usernames map to service bindings.
CREATE FUNCTION record_radius_accounting(p_tenant uuid, p_record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, network_worker AS $$
DECLARE nas operations_nas_clients%ROWTYPE; svc_id uuid; sub_id uuid; sess operations_radius_sessions%ROWTYPE;
 v_status text; BEGIN
 IF session_user <> 'orvex_network_worker' THEN
  RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='network worker identity is required';
 END IF;
 v_status := p_record->>'statusType';
 IF v_status NOT IN ('start','interim','stop') OR length(btrim(coalesce(p_record->>'acctSessionId',''))) = 0
   OR length(btrim(coalesce(p_record->>'username',''))) = 0 THEN
  RAISE EXCEPTION USING ERRCODE='N4000', MESSAGE='invalid accounting record';
 END IF;
 SELECT * INTO nas FROM operations_nas_clients WHERE tenant_id=p_tenant AND ip_address=(p_record->>'nasIpAddress')::inet AND active;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4033', MESSAGE='accounting from an unregistered NAS is refused'; END IF;
 SELECT b.service_id, s.subscriber_id INTO svc_id, sub_id FROM network_worker.service_bindings b
  JOIN operations_services s ON s.tenant_id=b.tenant_id AND s.id=b.service_id
  WHERE b.tenant_id=p_tenant AND b.account_name=p_record->>'username' LIMIT 1;
 INSERT INTO operations_radius_sessions(tenant_id,nas_id,nas_ip_address,subscriber_id,service_id,acct_session_id,username,
   framed_ip_address,calling_station_id,started_at,stopped_at,input_octets,output_octets,terminate_cause)
 VALUES(p_tenant,nas.id,nas.ip_address,sub_id,svc_id,p_record->>'acctSessionId',p_record->>'username',
   nullif(p_record->>'framedIpAddress','')::inet,nullif(p_record->>'callingStationId',''),
   coalesce(nullif(p_record->>'startedAt','')::timestamptz,clock_timestamp()),
   CASE WHEN v_status='stop' THEN coalesce(nullif(p_record->>'stoppedAt','')::timestamptz,clock_timestamp()) END,
   coalesce((p_record->>'inputOctets')::bigint,0),coalesce((p_record->>'outputOctets')::bigint,0),
   CASE WHEN v_status='stop' THEN nullif(p_record->>'terminateCause','') END)
 ON CONFLICT (tenant_id, acct_session_id) DO UPDATE SET
   framed_ip_address=coalesce(excluded.framed_ip_address, operations_radius_sessions.framed_ip_address),
   input_octets=greatest(operations_radius_sessions.input_octets, excluded.input_octets),
   output_octets=greatest(operations_radius_sessions.output_octets, excluded.output_octets),
   stopped_at=coalesce(operations_radius_sessions.stopped_at, excluded.stopped_at),
   terminate_cause=coalesce(operations_radius_sessions.terminate_cause, excluded.terminate_cause),
   updated_at=clock_timestamp()
 RETURNING * INTO sess;
 RETURN jsonb_build_object('sessionId', sess.id, 'serviceId', sess.service_id, 'stoppedAt', sess.stopped_at);
END $$;

-- Accounting arrives from the network worker, which carries no signed tenant request context.
-- Its identity (never a table grant: the worker reaches these rows only through the SECURITY DEFINER
-- ingest above) admits it to the NAS registry, the session ledger and the service row it links.
CREATE POLICY network_worker_accounting_nas ON operations_nas_clients FOR SELECT
  USING (session_user = 'orvex_network_worker');
CREATE POLICY network_worker_accounting_sessions ON operations_radius_sessions FOR ALL
  USING (session_user = 'orvex_network_worker') WITH CHECK (session_user = 'orvex_network_worker');
CREATE POLICY network_worker_accounting_services ON operations_services FOR SELECT
  USING (session_user = 'orvex_network_worker');

REVOKE ALL ON FUNCTION read_network_routers() FROM PUBLIC;
REVOKE ALL ON FUNCTION read_network_bindings() FROM PUBLIC;
REVOKE ALL ON FUNCTION read_network_jobs(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION execute_network_command(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_radius_accounting(uuid, jsonb) FROM PUBLIC, orvex_runtime;
GRANT EXECUTE ON FUNCTION read_network_routers() TO orvex_runtime;
GRANT EXECUTE ON FUNCTION read_network_bindings() TO orvex_runtime;
GRANT EXECUTE ON FUNCTION read_network_jobs(text, integer) TO orvex_runtime;
GRANT EXECUTE ON FUNCTION execute_network_command(jsonb) TO orvex_runtime;
GRANT EXECUTE ON FUNCTION record_radius_accounting(uuid, jsonb) TO orvex_network_worker;

-- The worker role's search_path is pinned to its own schema and it executes only granted
-- SECURITY DEFINER wrappers, so accounting ingest is exposed there and delegates to public.
CREATE FUNCTION network_worker.record_accounting(p_tenant uuid, p_record jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, network_worker AS $$
  SELECT public.record_radius_accounting(p_tenant, p_record)
$$;
REVOKE ALL ON FUNCTION network_worker.record_accounting(uuid, jsonb) FROM PUBLIC, orvex_runtime;
GRANT EXECUTE ON FUNCTION network_worker.record_accounting(uuid, jsonb) TO orvex_network_worker;
