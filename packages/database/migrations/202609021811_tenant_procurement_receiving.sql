-- REQ-WHS-002/REQ-FIN-001: governed vendor, PO approval, serialized receiving, and valuation.
CREATE TABLE operations_procurement_vendors(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_code text NOT NULL CHECK(length(btrim(vendor_code)) BETWEEN 2 AND 50),
  name_en text NOT NULL CHECK(length(btrim(name_en)) BETWEEN 2 AND 180),
  name_ar text NOT NULL CHECK(length(btrim(name_ar)) BETWEEN 2 AND 180),
  contact_name text,
  contact_phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,vendor_code),
  UNIQUE(tenant_id,id)
);

ALTER TABLE operations_purchase_orders DROP CONSTRAINT operations_purchase_orders_status_check;
ALTER TABLE operations_purchase_orders
  ADD COLUMN vendor_id uuid,
  ADD COLUMN warehouse_id uuid,
  ADD COLUMN branch_id uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN approved_at timestamptz,
  ADD CONSTRAINT purchase_order_status CHECK(status IN('draft','approved','received','cancelled')),
  ADD CONSTRAINT purchase_order_tenant_identity UNIQUE(tenant_id,id),
  ADD CONSTRAINT purchase_order_vendor_tenant FOREIGN KEY(tenant_id,vendor_id)
    REFERENCES operations_procurement_vendors(tenant_id,id),
  ADD CONSTRAINT purchase_order_warehouse_tenant FOREIGN KEY(tenant_id,warehouse_id)
    REFERENCES operations_warehouses(tenant_id,id),
  ADD CONSTRAINT purchase_order_branch_tenant FOREIGN KEY(tenant_id,branch_id)
    REFERENCES operations_branches(tenant_id,id);

ALTER TABLE operations_inventory_items ADD CONSTRAINT inventory_item_tenant_identity UNIQUE(tenant_id,id);

CREATE TABLE operations_purchase_order_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK(line_number>0),
  item_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0 AND quantity<=10000),
  received_quantity integer NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity),
  unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>0 AND unit_cost_minor<=9007199254740991),
  FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES operations_purchase_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES operations_inventory_items(tenant_id,id),
  UNIQUE(tenant_id,purchase_order_id,line_number),
  UNIQUE(tenant_id,id)
);

ALTER TABLE operations_serialized_assets
  ADD COLUMN purchase_order_id uuid,
  ADD COLUMN purchase_order_line_id uuid,
  ADD CONSTRAINT asset_purchase_order_tenant FOREIGN KEY(tenant_id,purchase_order_id)
    REFERENCES operations_purchase_orders(tenant_id,id),
  ADD CONSTRAINT asset_purchase_line_tenant FOREIGN KEY(tenant_id,purchase_order_line_id)
    REFERENCES operations_purchase_order_lines(tenant_id,id);

CREATE TABLE operations_procurement_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL CHECK(aggregate_type IN('vendor','purchase_order')),
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK(aggregate_version>0),
  action text NOT NULL CHECK(action IN('create_vendor','create_purchase_order','approve_purchase_order','receive_purchase_order')),
  reason_en text NOT NULL CHECK(length(btrim(reason_en)) BETWEEN 8 AND 1000),
  reason_ar text NOT NULL CHECK(length(btrim(reason_ar)) BETWEEN 8 AND 1000),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 8 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  UNIQUE(tenant_id,idempotency_key)
);

CREATE FUNCTION procurement_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
    AND c.permission IN('tenant.installation.view','tenant.catalog.manage','tenant.accounting.post'))
$$;
REVOKE ALL ON FUNCTION procurement_scope_allows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement_scope_allows(uuid) TO orvex_runtime;

CREATE OR REPLACE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action='tenant.warehouse.procurement.manage'))
   AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
   AND (c.record_ids IS NULL OR (target_record IS NOT NULL AND target_record=ANY(c.record_ids))))
$$;

CREATE OR REPLACE FUNCTION inventory_catalog_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action='tenant.warehouse.procurement.manage')))
$$;

CREATE OR REPLACE FUNCTION inventory_asset_scope_allows(
 target_tenant uuid,target_asset uuid,target_warehouse uuid,target_service uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
  AND c.support_grant_id IS NULL AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
   (c.permission='tenant.catalog.manage' AND c.action='tenant.warehouse.procurement.manage')))
 AND (
  EXISTS(SELECT 1 FROM operations_warehouses w WHERE w.tenant_id=target_tenant
   AND w.id=target_warehouse AND inventory_warehouse_scope_allows(w.tenant_id,w.branch_id,target_asset))
  OR EXISTS(SELECT 1 FROM operations_services s WHERE s.tenant_id=target_tenant
   AND s.id=target_service AND operations_scope_allows(s.tenant_id,s.branch_id,s.area_id,s.route_id,s.id))
 )
$$;

CREATE OR REPLACE FUNCTION accounting_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
   AND c.support_grant_id IS NULL AND (
    (c.permission IN('tenant.accounting.view','tenant.accounting.post','tenant.accounting.close')
      AND operations_scope_allows(target_tenant)) OR
    (c.permission='tenant.catalog.manage' AND c.action='tenant.warehouse.procurement.manage')))
$$;

CREATE FUNCTION procurement_order_scope_allows(target_tenant uuid,target_order uuid,target_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
    AND c.permission IN('tenant.installation.view','tenant.catalog.manage','tenant.accounting.post')
    AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
    AND (c.record_ids IS NULL OR target_order=ANY(c.record_ids)))
$$;
REVOKE ALL ON FUNCTION procurement_order_scope_allows(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION procurement_order_scope_allows(uuid,uuid,uuid) TO orvex_runtime;

ALTER TABLE operations_procurement_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_procurement_vendors FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_purchase_order_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_procurement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_procurement_events FORCE ROW LEVEL SECURITY;
DROP POLICY tenant_isolation_purchase_orders ON operations_purchase_orders;
CREATE POLICY procurement_vendor_scope ON operations_procurement_vendors
  USING(procurement_scope_allows(tenant_id)) WITH CHECK(procurement_scope_allows(tenant_id));
CREATE POLICY procurement_order_scope ON operations_purchase_orders
  USING(procurement_order_scope_allows(tenant_id,id,branch_id))
  WITH CHECK(procurement_order_scope_allows(tenant_id,id,branch_id));
CREATE POLICY procurement_line_scope ON operations_purchase_order_lines
  USING(EXISTS(SELECT 1 FROM operations_purchase_orders p WHERE p.tenant_id=operations_purchase_order_lines.tenant_id
    AND p.id=operations_purchase_order_lines.purchase_order_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_purchase_orders p WHERE p.tenant_id=operations_purchase_order_lines.tenant_id
    AND p.id=operations_purchase_order_lines.purchase_order_id));
CREATE POLICY procurement_event_scope ON operations_procurement_events
  USING((aggregate_type='vendor' AND procurement_scope_allows(tenant_id)) OR
    (aggregate_type='purchase_order' AND EXISTS(SELECT 1 FROM operations_purchase_orders p
      WHERE p.tenant_id=operations_procurement_events.tenant_id AND p.id=operations_procurement_events.aggregate_id)))
  WITH CHECK((aggregate_type='vendor' AND procurement_scope_allows(tenant_id)) OR
    (aggregate_type='purchase_order' AND EXISTS(SELECT 1 FROM operations_purchase_orders p
      WHERE p.tenant_id=operations_procurement_events.tenant_id AND p.id=operations_procurement_events.aggregate_id)));

REVOKE ALL ON operations_procurement_vendors,operations_purchase_orders,
  operations_purchase_order_lines,operations_procurement_events FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_procurement_vendors,operations_purchase_orders,
  operations_purchase_order_lines,operations_procurement_events TO orvex_runtime;
CREATE TRIGGER procurement_event_immutable BEFORE UPDATE OR DELETE ON operations_procurement_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER procurement_event_no_truncate BEFORE TRUNCATE ON operations_procurement_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER procurement_line_no_delete BEFORE DELETE ON operations_purchase_order_lines
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

ALTER TABLE operations_journal_entries DROP CONSTRAINT operations_journal_entries_source_type_check;
ALTER TABLE operations_journal_entries ADD CONSTRAINT operations_journal_entries_source_type_check
 CHECK(source_type IN('invoice','payment','credit_note','deposit','expense','manual','close','inventory_receipt'));
CREATE UNIQUE INDEX journal_inventory_receipt_once ON operations_journal_entries(tenant_id,source_id)
 WHERE source_type='inventory_receipt';

CREATE FUNCTION execute_procurement_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_procurement_events%ROWTYPE;
 vendor operations_procurement_vendors%ROWTYPE; po operations_purchase_orders%ROWTYPE;
 wh operations_warehouses%ROWTYPE; line record; asset jsonb; answer jsonb; before_value jsonb;
 total bigint:=0; journal uuid; aggregate uuid; aggregate_version integer:=1; expected_count integer;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed tenant procurement authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual procurement evidence is required';
 END IF;
 IF (payload->>'action' IN('create_vendor','create_purchase_order','receive_purchase_order')
      AND (c.permission<>'tenant.catalog.manage' OR c.action<>'tenant.warehouse.procurement.manage'))
   OR (payload->>'action'='approve_purchase_order'
      AND (c.permission<>'tenant.accounting.post' OR c.action<>'tenant.warehouse.procurement.approve')) THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize this procurement command';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':procurement:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_procurement_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='procurement retry key belongs to different content';
  END IF;
  RETURN prior.result;
 END IF;

 CASE payload->>'action'
 WHEN 'create_vendor' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
   ('action','vendorCode','nameEn','nameAr','contactName','contactPhone','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown vendor field'; END IF;
  INSERT INTO operations_procurement_vendors(tenant_id,vendor_code,name_en,name_ar,contact_name,contact_phone)
  VALUES(c.tenant_id,btrim(payload->>'vendorCode'),btrim(payload->>'nameEn'),btrim(payload->>'nameAr'),
   nullif(btrim(payload->>'contactName'),''),nullif(btrim(payload->>'contactPhone'),'')) RETURNING * INTO vendor;
  aggregate:=vendor.id; answer:=jsonb_build_object('id',vendor.id,'status','active','version',1);

 WHEN 'create_purchase_order' THEN
  IF jsonb_typeof(payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='purchase order requires 1 to 100 lines'; END IF;
  SELECT * INTO vendor FROM operations_procurement_vendors WHERE tenant_id=c.tenant_id
   AND id=(payload->>'vendorId')::uuid AND active FOR SHARE;
  SELECT * INTO wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'warehouseId')::uuid AND active FOR SHARE;
  IF vendor.id IS NULL OR wh.id IS NULL
    OR (c.branch_ids IS NOT NULL AND (wh.branch_id IS NULL OR NOT wh.branch_id=ANY(c.branch_ids)))
    OR c.record_ids IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='vendor or receiving warehouse is unavailable'; END IF;
  FOR line IN SELECT value,row_number() OVER() AS number FROM jsonb_array_elements(payload->'lines') LOOP
   IF NOT EXISTS(SELECT 1 FROM operations_inventory_items i WHERE i.tenant_id=c.tenant_id
      AND i.id=(line.value->>'itemId')::uuid AND i.serialized_flag) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='this receiving workflow requires serialized catalog items'; END IF;
   IF (line.value->>'unitCostMinor')::bigint > 9007199254740991 / (line.value->>'quantity')::integer THEN
    RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='purchase order line exceeds safe money range'; END IF;
   total:=total+((line.value->>'quantity')::integer*(line.value->>'unitCostMinor')::bigint);
   IF total>9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='purchase order exceeds safe money range'; END IF;
  END LOOP;
  INSERT INTO operations_purchase_orders(tenant_id,po_number,supplier_name,vendor_id,warehouse_id,branch_id,status,total_amount_minor,currency)
  VALUES(c.tenant_id,btrim(payload->>'poNumber'),vendor.name_en,vendor.id,wh.id,wh.branch_id,'draft',total,payload->>'currency') RETURNING * INTO po;
  INSERT INTO operations_purchase_order_lines(tenant_id,purchase_order_id,line_number,item_id,quantity,unit_cost_minor)
   SELECT c.tenant_id,po.id,ordinality,(value->>'itemId')::uuid,(value->>'quantity')::integer,
    (value->>'unitCostMinor')::bigint FROM jsonb_array_elements(payload->'lines') WITH ORDINALITY;
  aggregate:=po.id; answer:=jsonb_build_object('id',po.id,'status',po.status,'version',po.version);

 WHEN 'approve_purchase_order' THEN
  SELECT * INTO po FROM operations_purchase_orders WHERE tenant_id=c.tenant_id
   AND id=(payload->>'purchaseOrderId')::uuid FOR UPDATE;
  IF po.id IS NULL OR po.status<>'draft' OR po.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='purchase order changed or cannot be approved'; END IF;
  IF NOT procurement_order_scope_allows(c.tenant_id,po.id,po.branch_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='purchase order is outside the current scope'; END IF;
  before_value:=to_jsonb(po);
  UPDATE operations_purchase_orders SET status='approved',approved_by=c.actor_id::uuid,
   approved_at=clock_timestamp(),version=version+1 WHERE id=po.id RETURNING * INTO po;
  aggregate:=po.id; aggregate_version:=po.version;
  answer:=jsonb_build_object('id',po.id,'status',po.status,'version',po.version);

 WHEN 'receive_purchase_order' THEN
  IF jsonb_typeof(payload->'assets') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'assets') NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='receiving requires serialized assets'; END IF;
  SELECT * INTO po FROM operations_purchase_orders WHERE tenant_id=c.tenant_id
   AND id=(payload->>'purchaseOrderId')::uuid FOR UPDATE;
  IF po.id IS NULL OR po.status<>'approved' OR po.approved_by IS NULL OR po.vendor_id IS NULL
    OR po.warehouse_id IS NULL OR po.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='purchase order changed or is not approved'; END IF;
  IF NOT procurement_order_scope_allows(c.tenant_id,po.id,po.branch_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='purchase order is outside the current scope'; END IF;
  before_value:=to_jsonb(po);
  FOR line IN SELECT l.* FROM operations_purchase_order_lines l WHERE l.tenant_id=c.tenant_id AND l.purchase_order_id=po.id FOR UPDATE LOOP
   SELECT count(*)::integer INTO expected_count FROM jsonb_array_elements(payload->'assets') a
    WHERE (a->>'lineId')::uuid=line.id;
   IF expected_count<>line.quantity-line.received_quantity THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='receipt must account for every outstanding serialized unit'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'assets') a LEFT JOIN operations_purchase_order_lines l
    ON l.tenant_id=c.tenant_id AND l.purchase_order_id=po.id AND l.id=(a->>'lineId')::uuid WHERE l.id IS NULL)
   OR (SELECT count(*) FROM jsonb_array_elements(payload->'assets'))<>(SELECT count(DISTINCT a->>'serialNumber') FROM jsonb_array_elements(payload->'assets') a) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='receipt contains an unknown line or duplicate serial'; END IF;
  FOR asset IN SELECT value FROM jsonb_array_elements(payload->'assets') LOOP
   INSERT INTO operations_serialized_assets(tenant_id,item_id,serial_number,mac_address,warehouse_id,status,purchase_order_id,purchase_order_line_id)
    SELECT c.tenant_id,l.item_id,btrim(asset->>'serialNumber'),nullif(btrim(asset->>'macAddress'),''),po.warehouse_id,'in_stock',po.id,l.id
    FROM operations_purchase_order_lines l WHERE l.tenant_id=c.tenant_id AND l.purchase_order_id=po.id AND l.id=(asset->>'lineId')::uuid;
  END LOOP;
  UPDATE operations_purchase_order_lines SET received_quantity=quantity WHERE tenant_id=c.tenant_id AND purchase_order_id=po.id;
  UPDATE operations_purchase_orders SET status='received',received_at=clock_timestamp(),version=version+1
   WHERE id=po.id RETURNING * INTO po;
  PERFORM seed_tenant_default_chart_of_accounts(c.tenant_id);
  INSERT INTO operations_chart_of_accounts(tenant_id,account_code,account_name_en,account_name_ar,account_type,currency,is_system) VALUES
   (c.tenant_id,'1300','Inventory USD','المخزون USD','asset','USD',true),
   (c.tenant_id,'1310','Inventory LBP','المخزون LBP','asset','LBP',true)
   ON CONFLICT(tenant_id,account_code) DO NOTHING;
  INSERT INTO operations_journal_entries(tenant_id,entry_number,entry_date,description_en,description_ar,
    source_type,source_id,posted_by,posting_version,idempotency_key,request_payload)
   VALUES(c.tenant_id,'GRN-'||po.id::text,(clock_timestamp() AT TIME ZONE 'UTC')::date,'Inventory receipt '||po.po_number,
    'استلام مخزون '||po.po_number,'inventory_receipt',po.id,c.actor_id::uuid,'v2',c.idempotency_key,payload)
   RETURNING id INTO journal;
  INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,currency)
   SELECT journal,c.tenant_id,id,po.total_amount_minor,po.currency FROM operations_chart_of_accounts
    WHERE tenant_id=c.tenant_id AND account_code=CASE po.currency WHEN 'LBP' THEN '1310' ELSE '1300' END;
  INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,credit_minor,currency)
   SELECT journal,c.tenant_id,id,po.total_amount_minor,po.currency FROM operations_chart_of_accounts
    WHERE tenant_id=c.tenant_id AND account_code=CASE po.currency WHEN 'LBP' THEN '2110' ELSE '2100' END;
  aggregate:=po.id; aggregate_version:=po.version;
  answer:=jsonb_build_object('id',po.id,'status',po.status,'version',po.version,'journalId',journal);
 ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown procurement action';
 END CASE;

 INSERT INTO operations_procurement_events(tenant_id,aggregate_type,aggregate_id,aggregate_version,action,
   reason_en,reason_ar,evidence,actor_id,idempotency_key,request_payload,result)
 VALUES(c.tenant_id,CASE payload->>'action' WHEN 'create_vendor' THEN 'vendor' ELSE 'purchase_order' END,
   aggregate,aggregate_version,payload->>'action',payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',
   c.actor_id::uuid,c.idempotency_key,payload,answer);
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_'||CASE payload->>'action' WHEN 'create_vendor' THEN 'procurement_vendors' ELSE 'purchase_orders' END,
   aggregate::text,c.actor_id,c.session_id,c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,
   'allowed',c.reason,before_value,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_procurement_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_procurement_command(jsonb) TO orvex_runtime;
