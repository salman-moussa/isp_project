-- REQ-WHS-001: branch-scoped, append-only serialized equipment custody.
ALTER TABLE operations_warehouses
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT warehouse_tenant_identity UNIQUE(tenant_id,id),
  ADD CONSTRAINT warehouse_branch_tenant FOREIGN KEY(tenant_id,branch_id)
    REFERENCES operations_branches(tenant_id,id);

ALTER TABLE operations_serialized_assets
  ADD COLUMN current_installation_id uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  ADD CONSTRAINT serialized_asset_tenant_identity UNIQUE(tenant_id,id),
  ADD CONSTRAINT asset_installation_tenant FOREIGN KEY(tenant_id,current_installation_id)
    REFERENCES operations_installations(tenant_id,id);

CREATE TABLE operations_inventory_custody_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 1),
  action text NOT NULL CHECK(action IN('issue','install','return','rma')),
  from_status text NOT NULL,
  to_status text NOT NULL,
  custodian_user_id uuid,
  installation_id uuid,
  warehouse_id uuid,
  reason_en text NOT NULL CHECK(length(btrim(reason_en)) BETWEEN 8 AND 1000),
  reason_ar text NOT NULL CHECK(length(btrim(reason_ar)) BETWEEN 8 AND 1000),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 8 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  FOREIGN KEY(tenant_id,asset_id) REFERENCES operations_serialized_assets(tenant_id,id),
  FOREIGN KEY(tenant_id,custodian_user_id) REFERENCES tenant_memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,installation_id) REFERENCES operations_installations(tenant_id,id),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(tenant_id,asset_id,version)
);

CREATE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND c.permission IN('tenant.installation.view','tenant.installation.manage')
   AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
   AND (c.record_ids IS NULL OR (target_record IS NOT NULL AND target_record=ANY(c.record_ids))))
$$;
REVOKE ALL ON FUNCTION inventory_warehouse_scope_allows(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory_warehouse_scope_allows(uuid,uuid,uuid) TO orvex_runtime;

CREATE FUNCTION inventory_catalog_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND c.permission IN('tenant.installation.view','tenant.installation.manage'))
$$;
REVOKE ALL ON FUNCTION inventory_catalog_scope_allows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory_catalog_scope_allows(uuid) TO orvex_runtime;

CREATE FUNCTION inventory_asset_scope_allows(
 target_tenant uuid,target_asset uuid,target_warehouse uuid,target_service uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
  AND c.support_grant_id IS NULL AND c.permission IN('tenant.installation.view','tenant.installation.manage'))
 AND (
  EXISTS(SELECT 1 FROM operations_warehouses w WHERE w.tenant_id=target_tenant
   AND w.id=target_warehouse AND inventory_warehouse_scope_allows(w.tenant_id,w.branch_id,target_asset))
  OR EXISTS(SELECT 1 FROM operations_services s WHERE s.tenant_id=target_tenant
   AND s.id=target_service AND operations_scope_allows(s.tenant_id,s.branch_id,s.area_id,s.route_id,s.id))
 )
$$;
REVOKE ALL ON FUNCTION inventory_asset_scope_allows(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory_asset_scope_allows(uuid,uuid,uuid,uuid) TO orvex_runtime;

DROP POLICY tenant_isolation_warehouses ON operations_warehouses;
DROP POLICY tenant_isolation_inventory_items ON operations_inventory_items;
DROP POLICY tenant_isolation_serialized_assets ON operations_serialized_assets;
CREATE POLICY inventory_warehouse_scope ON operations_warehouses
  USING(inventory_warehouse_scope_allows(tenant_id,branch_id,id))
  WITH CHECK(inventory_warehouse_scope_allows(tenant_id,branch_id,id));
CREATE POLICY inventory_asset_scope ON operations_serialized_assets
  USING(inventory_asset_scope_allows(tenant_id,id,warehouse_id,installed_service_id))
  WITH CHECK(inventory_asset_scope_allows(tenant_id,id,warehouse_id,installed_service_id));
CREATE POLICY inventory_catalog_scope ON operations_inventory_items
  USING(inventory_catalog_scope_allows(tenant_id))
  WITH CHECK(inventory_catalog_scope_allows(tenant_id));

ALTER TABLE operations_inventory_custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_inventory_custody_events FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_event_scope ON operations_inventory_custody_events
  USING(EXISTS(SELECT 1 FROM operations_serialized_assets a
    WHERE a.tenant_id=operations_inventory_custody_events.tenant_id
      AND a.id=operations_inventory_custody_events.asset_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_serialized_assets a
    WHERE a.tenant_id=operations_inventory_custody_events.tenant_id
      AND a.id=operations_inventory_custody_events.asset_id));

REVOKE ALL ON operations_warehouses,operations_inventory_items,operations_serialized_assets,
  operations_inventory_custody_events FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_warehouses,operations_inventory_items,operations_serialized_assets,
  operations_inventory_custody_events TO orvex_runtime;

CREATE TRIGGER inventory_event_immutable BEFORE UPDATE OR DELETE ON operations_inventory_custody_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER inventory_event_no_truncate BEFORE TRUNCATE ON operations_inventory_custody_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER inventory_asset_no_delete BEFORE DELETE ON operations_serialized_assets
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

CREATE FUNCTION execute_inventory_custody(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; a operations_serialized_assets%ROWTYPE;
 prior operations_inventory_custody_events%ROWTYPE; inst operations_installations%ROWTYPE;
 wh operations_warehouses%ROWTYPE; next_status text; answer jsonb; before_value jsonb;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
   OR c.permission<>'tenant.installation.manage' OR c.action<>'tenant.warehouse.custody.transition' THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed inventory custody authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
     ('assetId','expectedVersion','action','installationId','custodianUserId','warehouseId','reasonEn','reasonAr','evidence'))
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual custody evidence is required';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':inventory:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_inventory_custody_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
   IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
     RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='custody retry key belongs to different content';
   END IF;
   RETURN prior.result;
 END IF;
 SELECT * INTO a FROM operations_serialized_assets
  WHERE tenant_id=c.tenant_id AND id=(payload->>'assetId')::uuid FOR UPDATE;
 IF NOT FOUND OR NOT inventory_asset_scope_allows(c.tenant_id,a.id,a.warehouse_id,a.installed_service_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='asset is outside the current scope';
 END IF;
 IF a.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='asset custody changed; refresh before acting';
 END IF;
 before_value:=to_jsonb(a);
 CASE payload->>'action'
  WHEN 'issue' THEN
   IF a.status NOT IN('in_stock','returned') OR payload->>'installationId' IS NULL OR payload->>'custodianUserId' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only stocked or returned equipment can be issued to an installation and custodian'; END IF;
   SELECT * INTO inst FROM operations_installations WHERE tenant_id=c.tenant_id
    AND id=(payload->>'installationId')::uuid FOR SHARE;
   IF NOT FOUND OR NOT operations_scope_allows_installation(c.tenant_id,inst.id) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='installation is outside the current scope'; END IF;
   IF inst.status NOT IN('scheduled','in_progress','ready_for_activation') THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='equipment can only be issued to active field work'; END IF;
   IF NOT EXISTS(SELECT 1 FROM tenant_memberships m WHERE m.tenant_id=c.tenant_id
      AND m.user_id=(payload->>'custodianUserId')::uuid AND m.active) THEN
    RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='custodian must be an active tenant member'; END IF;
   next_status:='issued';
   UPDATE operations_serialized_assets SET status=next_status,warehouse_id=NULL,
    current_custodian_id=(payload->>'custodianUserId')::uuid,current_installation_id=inst.id,
    installed_service_id=inst.service_id,version=version+1 WHERE tenant_id=c.tenant_id AND id=a.id RETURNING * INTO a;
  WHEN 'install' THEN
   IF a.status<>'issued' OR a.current_installation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only issued equipment can be marked installed'; END IF;
   next_status:='installed';
   UPDATE operations_serialized_assets SET status=next_status,version=version+1
    WHERE tenant_id=c.tenant_id AND id=a.id RETURNING * INTO a;
  WHEN 'return' THEN
   IF a.status NOT IN('issued','installed') OR payload->>'warehouseId' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only issued or installed equipment can be returned to a warehouse'; END IF;
   SELECT * INTO wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
    AND id=(payload->>'warehouseId')::uuid AND active FOR SHARE;
   IF NOT FOUND OR NOT inventory_warehouse_scope_allows(wh.tenant_id,wh.branch_id,a.id) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='return warehouse is outside the current scope'; END IF;
   next_status:='returned';
   UPDATE operations_serialized_assets SET status=next_status,warehouse_id=wh.id,
    current_custodian_id=NULL,current_installation_id=NULL,installed_service_id=NULL,version=version+1
    WHERE tenant_id=c.tenant_id AND id=a.id RETURNING * INTO a;
  WHEN 'rma' THEN
   IF a.status<>'returned' THEN RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only returned equipment can enter RMA'; END IF;
   next_status:='rma';
   UPDATE operations_serialized_assets SET status=next_status,version=version+1
    WHERE tenant_id=c.tenant_id AND id=a.id RETURNING * INTO a;
  ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown custody action';
 END CASE;
 answer:=jsonb_build_object('id',a.id,'status',a.status,'version',a.version);
 INSERT INTO operations_inventory_custody_events(tenant_id,asset_id,version,action,from_status,to_status,
  custodian_user_id,installation_id,warehouse_id,reason_en,reason_ar,evidence,actor_id,idempotency_key,request_payload,result)
 VALUES(c.tenant_id,a.id,a.version,payload->>'action',before_value->>'status',a.status,a.current_custodian_id,
  a.current_installation_id,a.warehouse_id,payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',
  c.actor_id::uuid,c.idempotency_key,payload,answer);
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
  permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_serialized_assets',a.id::text,c.actor_id,c.session_id,c.permission,
  c.request_id,c.idempotency_key,c.ip_address,c.user_agent,'allowed',c.reason,before_value,to_jsonb(a));
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_inventory_custody(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_inventory_custody(jsonb) TO orvex_runtime;
