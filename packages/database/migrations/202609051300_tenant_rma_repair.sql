-- REQ-WHS-007: serialized RMA and repair lifecycle.
--
-- A serialized asset could already be moved to the 'rma' status, but that was a dead end: there was
-- no case, no vendor, no outcome, and no way to write off a device that never came back. This
-- migration gives RMA a lifecycle with an append-only event trail and the accounting consequence
-- that a scrapped device actually has.

CREATE TABLE operations_rma_cases(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_number text NOT NULL CHECK(length(btrim(case_number)) BETWEEN 2 AND 80),
  asset_id uuid NOT NULL,
  vendor_id uuid,
  warehouse_id uuid NOT NULL,
  fault_summary text NOT NULL CHECK(length(btrim(fault_summary)) BETWEEN 8 AND 1000),
  status text NOT NULL DEFAULT 'open'
    CHECK(status IN('open','sent_to_vendor','repaired','replaced','scrapped','closed')),
  replacement_asset_id uuid,
  journal_entry_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  opened_by uuid NOT NULL REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  FOREIGN KEY(tenant_id,asset_id) REFERENCES operations_serialized_assets(tenant_id,id),
  FOREIGN KEY(tenant_id,replacement_asset_id) REFERENCES operations_serialized_assets(tenant_id,id),
  FOREIGN KEY(tenant_id,vendor_id) REFERENCES operations_procurement_vendors(tenant_id,id),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  UNIQUE(tenant_id,case_number),
  UNIQUE(tenant_id,id)
);
-- One open case per asset: a device cannot be at two vendors at once.
CREATE UNIQUE INDEX rma_single_open_per_asset ON operations_rma_cases(tenant_id,asset_id)
  WHERE status NOT IN('closed','scrapped');

CREATE TABLE operations_rma_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  case_version integer NOT NULL CHECK(case_version>0),
  action text NOT NULL CHECK(action IN(
    'open_case','send_to_vendor','receive_repaired','receive_replacement','scrap_asset','close_case')),
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason_en text NOT NULL CHECK(length(btrim(reason_en)) BETWEEN 8 AND 1000),
  reason_ar text NOT NULL CHECK(length(btrim(reason_ar)) BETWEEN 8 AND 1000),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 8 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  FOREIGN KEY(tenant_id,case_id) REFERENCES operations_rma_cases(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(tenant_id,case_id,case_version)
);

ALTER TABLE operations_journal_entries DROP CONSTRAINT operations_journal_entries_source_type_check;
ALTER TABLE operations_journal_entries ADD CONSTRAINT operations_journal_entries_source_type_check
  CHECK(source_type IN('invoice','payment','credit_note','deposit','expense','manual','close',
    'inventory_receipt','inventory_adjustment','inventory_consumption','inventory_count',
    'inventory_scrap'));

DROP INDEX journal_inventory_source_once;
CREATE UNIQUE INDEX journal_inventory_source_once ON operations_journal_entries(tenant_id,idempotency_key)
  WHERE source_type IN('inventory_receipt','inventory_adjustment','inventory_consumption',
    'inventory_count','inventory_scrap');

-- Serialized assets gain a terminal 'scrapped' state; 'rma' remains the in-repair state.
ALTER TABLE operations_serialized_assets DROP CONSTRAINT operations_serialized_assets_status_check;
ALTER TABLE operations_serialized_assets ADD CONSTRAINT operations_serialized_assets_status_check
  CHECK(status IN('in_stock','reserved','issued','installed','returned','rma','scrapped'));

ALTER TABLE operations_rma_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_rma_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_rma_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_rma_events FORCE ROW LEVEL SECURITY;

-- Scrapping writes value off, so finance signs it; the rest is warehouse work.
CREATE OR REPLACE FUNCTION inventory_asset_scope_allows(
 target_tenant uuid,target_asset uuid,target_warehouse uuid,target_service uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
  AND c.support_grant_id IS NULL AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
   (c.permission='tenant.catalog.manage' AND c.action IN(
     'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
   (c.permission='tenant.accounting.post' AND c.action='tenant.warehouse.rma.scrap')))
 AND (
  EXISTS(SELECT 1 FROM operations_warehouses w WHERE w.tenant_id=target_tenant
   AND w.id=target_warehouse AND inventory_warehouse_scope_allows(w.tenant_id,w.branch_id,target_asset))
  OR EXISTS(SELECT 1 FROM operations_services s WHERE s.tenant_id=target_tenant
   AND s.id=target_service AND operations_scope_allows(s.tenant_id,s.branch_id,s.area_id,s.route_id,s.id))
 )
$$;

CREATE OR REPLACE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action IN(
       'tenant.warehouse.stock.adjust','tenant.warehouse.stock.count.close','tenant.warehouse.rma.scrap')))
   AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
   AND (c.record_ids IS NULL OR (target_record IS NOT NULL AND target_record=ANY(c.record_ids))))
$$;

CREATE OR REPLACE FUNCTION inventory_catalog_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action IN(
       'tenant.warehouse.stock.adjust','tenant.warehouse.stock.count.close','tenant.warehouse.rma.scrap'))))
$$;

-- An RMA case names the vendor the device is sent to, so the RMA session must be able to read
-- the vendor register. It was previously reachable only from procurement and finance sessions.
CREATE OR REPLACE FUNCTION procurement_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
    AND (c.permission IN('tenant.installation.view','tenant.catalog.manage','tenant.accounting.post')
      OR (c.permission='tenant.installation.manage' AND c.action='tenant.warehouse.rma.manage')))
$$;

CREATE POLICY rma_case_scope ON operations_rma_cases
  USING(stock_location_scope_allows(tenant_id,warehouse_id))
  WITH CHECK(stock_location_scope_allows(tenant_id,warehouse_id));
CREATE POLICY rma_event_scope ON operations_rma_events
  USING(EXISTS(SELECT 1 FROM operations_rma_cases k
    WHERE k.tenant_id=operations_rma_events.tenant_id AND k.id=operations_rma_events.case_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_rma_cases k
    WHERE k.tenant_id=operations_rma_events.tenant_id AND k.id=operations_rma_events.case_id));

REVOKE ALL ON operations_rma_cases,operations_rma_events FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_rma_cases,operations_rma_events TO orvex_runtime;

CREATE TRIGGER rma_event_immutable BEFORE UPDATE OR DELETE ON operations_rma_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER rma_event_no_truncate BEFORE TRUNCATE ON operations_rma_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER rma_case_no_delete BEFORE DELETE ON operations_rma_cases
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

CREATE FUNCTION execute_rma_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_rma_events%ROWTYPE;
 rma operations_rma_cases%ROWTYPE; asset operations_serialized_assets%ROWTYPE;
 replacement operations_serialized_assets%ROWTYPE; item operations_inventory_items%ROWTYPE;
 wh operations_warehouses%ROWTYPE; vendor operations_procurement_vendors%ROWTYPE;
 answer jsonb; from_status text; journal uuid; currency text; unit_cost bigint;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed tenant RMA authority required';
 END IF;
 -- Scrapping destroys value and is finance work; the rest of the lifecycle is warehouse work.
 IF (payload->>'action'='scrap_asset'
      AND (c.permission<>'tenant.accounting.post' OR c.action<>'tenant.warehouse.rma.scrap'))
   OR (payload->>'action'<>'scrap_asset'
      AND (c.permission<>'tenant.installation.manage' OR c.action<>'tenant.warehouse.rma.manage')) THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize this RMA command';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual RMA evidence is required';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':rma:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_rma_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='RMA retry key belongs to different content';
  END IF;
  RETURN prior.result;
 END IF;

 IF payload->>'action'='open_case' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','caseNumber','assetId','vendorId','faultSummary','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown RMA field'; END IF;
  SELECT * INTO asset FROM operations_serialized_assets
   WHERE tenant_id=c.tenant_id AND id=(payload->>'assetId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT inventory_asset_scope_allows(c.tenant_id,asset.id,asset.warehouse_id,asset.installed_service_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='asset is outside the current scope'; END IF;
  -- Only a device physically back in a warehouse can enter a repair case.
  IF asset.status NOT IN('returned','in_stock') OR asset.warehouse_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4091',
    MESSAGE='only returned or stocked equipment held in a warehouse can enter RMA'; END IF;
  IF payload->>'vendorId' IS NOT NULL THEN
   SELECT * INTO vendor FROM operations_procurement_vendors WHERE tenant_id=c.tenant_id
    AND id=(payload->>'vendorId')::uuid AND active FOR SHARE;
   IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='vendor is unavailable'; END IF;
  END IF;
  INSERT INTO operations_rma_cases(tenant_id,case_number,asset_id,vendor_id,warehouse_id,
    fault_summary,opened_by)
  VALUES(c.tenant_id,btrim(payload->>'caseNumber'),asset.id,
    nullif(payload->>'vendorId','')::uuid,asset.warehouse_id,btrim(payload->>'faultSummary'),
    c.actor_id::uuid) RETURNING * INTO rma;
  from_status := asset.status;
  UPDATE operations_serialized_assets SET status='rma',version=version+1
   WHERE tenant_id=c.tenant_id AND id=asset.id RETURNING * INTO asset;
  answer := jsonb_build_object('action','open_case','caseId',rma.id,'status',rma.status,
    'version',rma.version,'assetStatus',asset.status);
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','caseId','expectedVersion','replacementSerialNumber','replacementMacAddress',
     'reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown RMA field'; END IF;
  SELECT * INTO rma FROM operations_rma_cases
   WHERE tenant_id=c.tenant_id AND id=(payload->>'caseId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT stock_location_scope_allows(c.tenant_id,rma.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='RMA case is outside the current scope'; END IF;
  IF rma.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='RMA case changed; refresh before acting'; END IF;
  from_status := rma.status;
  SELECT * INTO asset FROM operations_serialized_assets
   WHERE tenant_id=c.tenant_id AND id=rma.asset_id FOR UPDATE;
  SELECT * INTO item FROM operations_inventory_items
   WHERE tenant_id=c.tenant_id AND id=asset.item_id FOR SHARE;

  CASE payload->>'action'
  WHEN 'send_to_vendor' THEN
   IF rma.status<>'open' THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open case can be sent to the vendor'; END IF;
   IF rma.vendor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='a case without a vendor cannot be shipped'; END IF;
   UPDATE operations_rma_cases SET status='sent_to_vendor',version=version+1
    WHERE id=rma.id RETURNING * INTO rma;

  WHEN 'receive_repaired' THEN
   IF rma.status<>'sent_to_vendor' THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only a shipped case can return repaired'; END IF;
   -- The same device comes back, so it returns to stock at its existing value.
   UPDATE operations_serialized_assets SET status='in_stock',warehouse_id=rma.warehouse_id,
     version=version+1 WHERE tenant_id=c.tenant_id AND id=asset.id RETURNING * INTO asset;
   UPDATE operations_rma_cases SET status='repaired',resolved_at=clock_timestamp(),version=version+1
    WHERE id=rma.id RETURNING * INTO rma;

  WHEN 'receive_replacement' THEN
   IF rma.status<>'sent_to_vendor' THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only a shipped case can receive a replacement'; END IF;
   IF length(btrim(coalesce(payload->>'replacementSerialNumber',''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a replacement requires its serial number'; END IF;
   -- The faulty unit is gone for good; the vendor's replacement enters stock in its place.
   INSERT INTO operations_serialized_assets(tenant_id,item_id,serial_number,mac_address,
     warehouse_id,status)
   VALUES(c.tenant_id,asset.item_id,btrim(payload->>'replacementSerialNumber'),
     nullif(btrim(payload->>'replacementMacAddress'),''),rma.warehouse_id,'in_stock')
   RETURNING * INTO replacement;
   -- The last known warehouse is retained: a scrapped device still has a place it was written
   -- off from, and clearing it would also put the row outside its own row-level security scope.
   UPDATE operations_serialized_assets SET status='scrapped',version=version+1
    WHERE tenant_id=c.tenant_id AND id=asset.id;
   UPDATE operations_rma_cases SET status='replaced',replacement_asset_id=replacement.id,
     resolved_at=clock_timestamp(),version=version+1 WHERE id=rma.id RETURNING * INTO rma;

  WHEN 'scrap_asset' THEN
   IF rma.status NOT IN('open','sent_to_vendor') THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open or shipped case can be scrapped'; END IF;
   currency := CASE WHEN item.unit_cost_minor_usd>0 THEN 'USD' ELSE 'LBP' END;
   unit_cost := CASE WHEN item.unit_cost_minor_usd>0 THEN item.unit_cost_minor_usd ELSE item.unit_cost_minor_lbp END;
   -- The last known warehouse is retained: a scrapped device still has a place it was written
   -- off from, and clearing it would also put the row outside its own row-level security scope.
   UPDATE operations_serialized_assets SET status='scrapped',version=version+1
    WHERE tenant_id=c.tenant_id AND id=asset.id RETURNING * INTO asset;
   -- Writing the device off is the accounting consequence a dead-end RMA actually has.
   journal := post_inventory_journal(c.tenant_id,c.actor_id::uuid,'inventory_scrap',rma.id,
     c.idempotency_key,'5200',CASE currency WHEN 'LBP' THEN '1310' ELSE '1300' END,
     unit_cost,currency,'Scrapped asset '||asset.serial_number,
     'إتلاف أصل '||asset.serial_number,payload);
   UPDATE operations_rma_cases SET status='scrapped',journal_entry_id=journal,
     resolved_at=clock_timestamp(),version=version+1 WHERE id=rma.id RETURNING * INTO rma;

  WHEN 'close_case' THEN
   IF rma.status NOT IN('repaired','replaced','scrapped') THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only a resolved case can be closed'; END IF;
   UPDATE operations_rma_cases SET status='closed',version=version+1
    WHERE id=rma.id RETURNING * INTO rma;

  ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown RMA action';
  END CASE;

  answer := jsonb_build_object('action',payload->>'action','caseId',rma.id,'status',rma.status,
    'version',rma.version,'assetStatus',asset.status,
    'replacementAssetId',rma.replacement_asset_id,'journalId',rma.journal_entry_id);
 END IF;

 INSERT INTO operations_rma_events(tenant_id,case_id,case_version,action,from_status,to_status,
   reason_en,reason_ar,evidence,actor_id,idempotency_key,request_payload,result)
 VALUES(c.tenant_id,rma.id,rma.version,payload->>'action',from_status,rma.status,
   payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
   c.idempotency_key,payload,answer);
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_rma_cases',rma.id::text,c.actor_id,c.session_id,
   c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,
   'allowed',c.reason,NULL,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_rma_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_rma_command(jsonb) TO orvex_runtime;
