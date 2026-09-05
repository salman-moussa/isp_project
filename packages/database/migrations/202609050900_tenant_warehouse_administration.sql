-- REQ-WHS-003: governed catalog, warehouse and bin administration.
--
-- Before this migration an ISP could receive stock but could not create the SKU,
-- warehouse or bin it is received into: those rows had to be inserted by a DBA.
-- Administration is now a signed, versioned, append-only command with the same
-- idempotency, scope and audit guarantees as procurement and custody.

ALTER TABLE operations_warehouses
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);

ALTER TABLE operations_inventory_items
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);

-- Exactly one primary warehouse per tenant. The command demotes the incumbent in the
-- same transaction, so an operator never has to leave the tenant without a primary.
-- Existing data is normalized first: the lowest warehouse code keeps the designation,
-- which is deterministic and never silently drops a tenant's only primary.
UPDATE operations_warehouses w SET is_primary=false
 WHERE w.is_primary AND w.id <> (
   SELECT k.id FROM operations_warehouses k
    WHERE k.tenant_id=w.tenant_id AND k.is_primary
    ORDER BY k.warehouse_code, k.id LIMIT 1);

CREATE UNIQUE INDEX warehouse_single_primary ON operations_warehouses(tenant_id)
  WHERE is_primary;

CREATE TABLE operations_warehouse_bins(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  bin_code text NOT NULL CHECK(length(btrim(bin_code)) BETWEEN 1 AND 40),
  name_en text NOT NULL CHECK(length(btrim(name_en)) BETWEEN 2 AND 150),
  name_ar text NOT NULL CHECK(length(btrim(name_ar)) BETWEEN 2 AND 150),
  bin_kind text NOT NULL DEFAULT 'stock'
    CHECK(bin_kind IN('stock','staging','quarantine','rma','scrap')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  UNIQUE(tenant_id,warehouse_id,bin_code),
  UNIQUE(tenant_id,id)
);

CREATE TABLE operations_warehouse_admin_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL CHECK(aggregate_type IN('item','warehouse','bin')),
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK(aggregate_version>0),
  action text NOT NULL CHECK(action IN(
    'create_item','update_item','create_warehouse','update_warehouse','create_bin','update_bin')),
  reason_en text NOT NULL CHECK(length(btrim(reason_en)) BETWEEN 8 AND 1000),
  reason_ar text NOT NULL CHECK(length(btrim(reason_ar)) BETWEEN 8 AND 1000),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 8 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  before_value jsonb,
  result jsonb NOT NULL,
  UNIQUE(tenant_id,idempotency_key),
  UNIQUE(tenant_id,aggregate_type,aggregate_id,aggregate_version)
);

-- Administration reuses the catalog-manage permission, distinguished from procurement by
-- its own signed action so a procurement operator cannot silently re-shape the catalog.
CREATE OR REPLACE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')))
   AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
   AND (c.record_ids IS NULL OR (target_record IS NOT NULL AND target_record=ANY(c.record_ids))))
$$;

CREATE OR REPLACE FUNCTION inventory_catalog_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage'))))
$$;

CREATE OR REPLACE FUNCTION inventory_asset_scope_allows(
 target_tenant uuid,target_asset uuid,target_warehouse uuid,target_service uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=target_tenant
  AND c.support_grant_id IS NULL AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
   (c.permission='tenant.catalog.manage' AND c.action IN(
     'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage'))))
 AND (
  EXISTS(SELECT 1 FROM operations_warehouses w WHERE w.tenant_id=target_tenant
   AND w.id=target_warehouse AND inventory_warehouse_scope_allows(w.tenant_id,w.branch_id,target_asset))
  OR EXISTS(SELECT 1 FROM operations_services s WHERE s.tenant_id=target_tenant
   AND s.id=target_service AND operations_scope_allows(s.tenant_id,s.branch_id,s.area_id,s.route_id,s.id))
 )
$$;

CREATE FUNCTION inventory_bin_scope_allows(target_tenant uuid,target_warehouse uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_warehouses w
  WHERE w.tenant_id=target_tenant AND w.id=target_warehouse
    AND inventory_warehouse_scope_allows(w.tenant_id,w.branch_id,w.id))
$$;
REVOKE ALL ON FUNCTION inventory_bin_scope_allows(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory_bin_scope_allows(uuid,uuid) TO orvex_runtime;

ALTER TABLE operations_warehouse_bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_warehouse_bins FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_warehouse_admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_warehouse_admin_events FORCE ROW LEVEL SECURITY;

CREATE POLICY inventory_bin_scope ON operations_warehouse_bins
  USING(inventory_bin_scope_allows(tenant_id,warehouse_id))
  WITH CHECK(inventory_bin_scope_allows(tenant_id,warehouse_id));

-- Administration history is readable exactly where the administered record is readable.
CREATE POLICY warehouse_admin_event_scope ON operations_warehouse_admin_events
  USING(
    (aggregate_type='item' AND inventory_catalog_scope_allows(tenant_id))
    OR (aggregate_type='warehouse' AND EXISTS(SELECT 1 FROM operations_warehouses w
      WHERE w.tenant_id=operations_warehouse_admin_events.tenant_id
        AND w.id=operations_warehouse_admin_events.aggregate_id))
    OR (aggregate_type='bin' AND EXISTS(SELECT 1 FROM operations_warehouse_bins b
      WHERE b.tenant_id=operations_warehouse_admin_events.tenant_id
        AND b.id=operations_warehouse_admin_events.aggregate_id)))
  WITH CHECK(
    (aggregate_type='item' AND inventory_catalog_scope_allows(tenant_id))
    OR (aggregate_type='warehouse' AND EXISTS(SELECT 1 FROM operations_warehouses w
      WHERE w.tenant_id=operations_warehouse_admin_events.tenant_id
        AND w.id=operations_warehouse_admin_events.aggregate_id))
    OR (aggregate_type='bin' AND EXISTS(SELECT 1 FROM operations_warehouse_bins b
      WHERE b.tenant_id=operations_warehouse_admin_events.tenant_id
        AND b.id=operations_warehouse_admin_events.aggregate_id)));

REVOKE ALL ON operations_warehouse_bins,operations_warehouse_admin_events FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_warehouse_bins,operations_warehouse_admin_events TO orvex_runtime;

CREATE TRIGGER warehouse_admin_event_immutable
 BEFORE UPDATE OR DELETE ON operations_warehouse_admin_events
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER warehouse_admin_event_no_truncate
 BEFORE TRUNCATE ON operations_warehouse_admin_events
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER warehouse_bin_no_delete BEFORE DELETE ON operations_warehouse_bins
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
-- operations_inventory_items and operations_warehouses deliberately keep no delete guard:
-- runtime holds SELECT only, so deletion is already impossible for the application, and a
-- BEFORE DELETE guard would block the tenant-deletion cascade these tables participate in.

CREATE FUNCTION execute_warehouse_admin_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_warehouse_admin_events%ROWTYPE;
 item operations_inventory_items%ROWTYPE; wh operations_warehouses%ROWTYPE;
 bin operations_warehouse_bins%ROWTYPE; branch operations_branches%ROWTYPE;
 answer jsonb; before_value jsonb; aggregate uuid; aggregate_kind text;
 aggregate_version integer; demoted uuid;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
   OR c.permission<>'tenant.catalog.manage' OR c.action<>'tenant.warehouse.administration.manage' THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed warehouse administration authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual administration evidence is required';
 END IF;

 -- The primary designation is tenant-wide and unique. A branch- or record-scoped operator
 -- cannot see the incumbent primary, so it could not be demoted and the write would fail on
 -- the unique index with an unhelpful error. Refuse it explicitly instead.
 IF (payload->>'isPrimary')::boolean AND (c.branch_ids IS NOT NULL OR c.record_ids IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='P4033',
   MESSAGE='only a tenant-wide warehouse administrator can set the primary warehouse';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':warehouse-admin:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_warehouse_admin_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='administration retry key belongs to different content';
  END IF;
  RETURN prior.result;
 END IF;

 CASE payload->>'action'
 WHEN 'create_item' THEN
  aggregate_kind:='item'; aggregate_version:=1;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','sku','nameEn','nameAr','category','unitCostMinorUsd','unitCostMinorLbp',
     'serializedFlag','reorderThreshold','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown catalog item field'; END IF;
  IF EXISTS(SELECT 1 FROM operations_inventory_items i
    WHERE i.tenant_id=c.tenant_id AND lower(i.sku)=lower(btrim(payload->>'sku'))) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='this SKU already exists for the tenant'; END IF;
  INSERT INTO operations_inventory_items(tenant_id,sku,name_en,name_ar,category,
    unit_cost_minor_usd,unit_cost_minor_lbp,serialized_flag,reorder_threshold)
  VALUES(c.tenant_id,btrim(payload->>'sku'),btrim(payload->>'nameEn'),btrim(payload->>'nameAr'),
    payload->>'category',(payload->>'unitCostMinorUsd')::bigint,(payload->>'unitCostMinorLbp')::bigint,
    (payload->>'serializedFlag')::boolean,(payload->>'reorderThreshold')::integer)
  RETURNING * INTO item;
  aggregate:=item.id;
  answer:=jsonb_build_object('id',item.id,'status','active','version',item.version);

 WHEN 'update_item' THEN
  aggregate_kind:='item';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','itemId','expectedVersion','nameEn','nameAr','category','unitCostMinorUsd',
     'unitCostMinorLbp','serializedFlag','reorderThreshold','active','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown catalog item field'; END IF;
  SELECT * INTO item FROM operations_inventory_items
   WHERE tenant_id=c.tenant_id AND id=(payload->>'itemId')::uuid FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='catalog item is outside the current scope'; END IF;
  IF item.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='catalog item changed; refresh before saving'; END IF;
  before_value:=to_jsonb(item);
  -- Serialization drives receiving, custody and valuation. Once stock or a purchase
  -- commitment exists the flag is history, not a setting.
  IF (payload->>'serializedFlag')::boolean IS DISTINCT FROM item.serialized_flag
    AND (EXISTS(SELECT 1 FROM operations_serialized_assets a
          WHERE a.tenant_id=c.tenant_id AND a.item_id=item.id)
      OR EXISTS(SELECT 1 FROM operations_purchase_order_lines l
          WHERE l.tenant_id=c.tenant_id AND l.item_id=item.id)) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',
    MESSAGE='serialization cannot change once stock or purchase commitments exist for this item';
  END IF;
  IF (payload->>'active')::boolean IS FALSE
    AND EXISTS(SELECT 1 FROM operations_purchase_order_lines l
      JOIN operations_purchase_orders p ON p.tenant_id=l.tenant_id AND p.id=l.purchase_order_id
      WHERE l.tenant_id=c.tenant_id AND l.item_id=item.id AND p.status IN('draft','approved')) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',
    MESSAGE='this item is on an open purchase order and cannot be retired yet';
  END IF;
  UPDATE operations_inventory_items SET name_en=btrim(payload->>'nameEn'),
    name_ar=btrim(payload->>'nameAr'),category=payload->>'category',
    unit_cost_minor_usd=(payload->>'unitCostMinorUsd')::bigint,
    unit_cost_minor_lbp=(payload->>'unitCostMinorLbp')::bigint,
    serialized_flag=(payload->>'serializedFlag')::boolean,
    reorder_threshold=(payload->>'reorderThreshold')::integer,
    active=(payload->>'active')::boolean,version=version+1
   WHERE tenant_id=c.tenant_id AND id=item.id RETURNING * INTO item;
  aggregate:=item.id; aggregate_version:=item.version;
  answer:=jsonb_build_object('id',item.id,
    'status',CASE WHEN item.active THEN 'active' ELSE 'retired' END,'version',item.version);

 WHEN 'create_warehouse' THEN
  aggregate_kind:='warehouse'; aggregate_version:=1;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','warehouseCode','nameEn','nameAr','locationAddress','branchId','isPrimary',
     'reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown warehouse field'; END IF;
  IF EXISTS(SELECT 1 FROM operations_warehouses w
    WHERE w.tenant_id=c.tenant_id AND lower(w.warehouse_code)=lower(btrim(payload->>'warehouseCode'))) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='this warehouse code already exists for the tenant'; END IF;
  SELECT * INTO branch FROM operations_branches
   WHERE tenant_id=c.tenant_id AND id=(payload->>'branchId')::uuid AND active FOR SHARE;
  IF NOT FOUND OR (c.branch_ids IS NOT NULL AND NOT branch.id=ANY(c.branch_ids)) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='branch is unavailable or outside the current scope'; END IF;
  IF (payload->>'isPrimary')::boolean THEN
   UPDATE operations_warehouses SET is_primary=false,version=version+1
    WHERE tenant_id=c.tenant_id AND is_primary RETURNING id INTO demoted;
  END IF;
  INSERT INTO operations_warehouses(tenant_id,warehouse_code,name_en,name_ar,location_address,
    branch_id,is_primary,active)
  VALUES(c.tenant_id,btrim(payload->>'warehouseCode'),btrim(payload->>'nameEn'),
    btrim(payload->>'nameAr'),btrim(payload->>'locationAddress'),branch.id,
    (payload->>'isPrimary')::boolean,true) RETURNING * INTO wh;
  aggregate:=wh.id;
  answer:=jsonb_build_object('id',wh.id,'status','active','version',wh.version,
    'demotedPrimaryWarehouseId',demoted);

 WHEN 'update_warehouse' THEN
  aggregate_kind:='warehouse';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','warehouseId','expectedVersion','nameEn','nameAr','locationAddress','branchId',
     'isPrimary','active','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown warehouse field'; END IF;
  SELECT * INTO wh FROM operations_warehouses
   WHERE tenant_id=c.tenant_id AND id=(payload->>'warehouseId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT inventory_warehouse_scope_allows(wh.tenant_id,wh.branch_id,wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='warehouse is outside the current scope'; END IF;
  IF wh.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='warehouse changed; refresh before saving'; END IF;
  SELECT * INTO branch FROM operations_branches
   WHERE tenant_id=c.tenant_id AND id=(payload->>'branchId')::uuid AND active FOR SHARE;
  IF NOT FOUND OR (c.branch_ids IS NOT NULL AND NOT branch.id=ANY(c.branch_ids)) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='branch is unavailable or outside the current scope'; END IF;
  before_value:=to_jsonb(wh);
  -- Closing a warehouse that still holds custody would strand that stock outside any
  -- location, so the operator must move it out first.
  IF (payload->>'active')::boolean IS FALSE THEN
   IF EXISTS(SELECT 1 FROM operations_serialized_assets a WHERE a.tenant_id=c.tenant_id
     AND a.warehouse_id=wh.id AND a.status IN('in_stock','reserved','returned')) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',
     MESSAGE='this warehouse still holds stock; transfer or issue it before closing'; END IF;
   IF EXISTS(SELECT 1 FROM operations_purchase_orders p WHERE p.tenant_id=c.tenant_id
     AND p.warehouse_id=wh.id AND p.status IN('draft','approved')) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',
     MESSAGE='this warehouse has open purchase orders and cannot be closed yet'; END IF;
   IF (payload->>'isPrimary')::boolean THEN
    RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a closed warehouse cannot be the primary warehouse'; END IF;
  END IF;
  IF (payload->>'isPrimary')::boolean AND NOT wh.is_primary THEN
   UPDATE operations_warehouses SET is_primary=false,version=version+1
    WHERE tenant_id=c.tenant_id AND is_primary AND id<>wh.id RETURNING id INTO demoted;
  END IF;
  UPDATE operations_warehouses SET name_en=btrim(payload->>'nameEn'),
    name_ar=btrim(payload->>'nameAr'),location_address=btrim(payload->>'locationAddress'),
    branch_id=branch.id,is_primary=(payload->>'isPrimary')::boolean,
    active=(payload->>'active')::boolean,version=version+1
   WHERE tenant_id=c.tenant_id AND id=wh.id RETURNING * INTO wh;
  aggregate:=wh.id; aggregate_version:=wh.version;
  answer:=jsonb_build_object('id',wh.id,
    'status',CASE WHEN wh.active THEN 'active' ELSE 'closed' END,'version',wh.version,
    'demotedPrimaryWarehouseId',demoted);

 WHEN 'create_bin' THEN
  aggregate_kind:='bin'; aggregate_version:=1;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','warehouseId','binCode','nameEn','nameAr','binKind','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown bin field'; END IF;
  SELECT * INTO wh FROM operations_warehouses
   WHERE tenant_id=c.tenant_id AND id=(payload->>'warehouseId')::uuid AND active FOR SHARE;
  IF NOT FOUND OR NOT inventory_warehouse_scope_allows(wh.tenant_id,wh.branch_id,wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='warehouse is unavailable or outside the current scope'; END IF;
  IF EXISTS(SELECT 1 FROM operations_warehouse_bins b WHERE b.tenant_id=c.tenant_id
    AND b.warehouse_id=wh.id AND lower(b.bin_code)=lower(btrim(payload->>'binCode'))) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='this bin code already exists in the warehouse'; END IF;
  INSERT INTO operations_warehouse_bins(tenant_id,warehouse_id,bin_code,name_en,name_ar,bin_kind)
  VALUES(c.tenant_id,wh.id,btrim(payload->>'binCode'),btrim(payload->>'nameEn'),
    btrim(payload->>'nameAr'),coalesce(payload->>'binKind','stock')) RETURNING * INTO bin;
  aggregate:=bin.id;
  answer:=jsonb_build_object('id',bin.id,'status','active','version',bin.version,'warehouseId',wh.id);

 WHEN 'update_bin' THEN
  aggregate_kind:='bin';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','binId','expectedVersion','nameEn','nameAr','binKind','active','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown bin field'; END IF;
  SELECT * INTO bin FROM operations_warehouse_bins
   WHERE tenant_id=c.tenant_id AND id=(payload->>'binId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT inventory_bin_scope_allows(bin.tenant_id,bin.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='bin is outside the current scope'; END IF;
  IF bin.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='bin changed; refresh before saving'; END IF;
  before_value:=to_jsonb(bin);
  UPDATE operations_warehouse_bins SET name_en=btrim(payload->>'nameEn'),
    name_ar=btrim(payload->>'nameAr'),bin_kind=coalesce(payload->>'binKind',bin_kind),
    active=(payload->>'active')::boolean,version=version+1
   WHERE tenant_id=c.tenant_id AND id=bin.id RETURNING * INTO bin;
  aggregate:=bin.id; aggregate_version:=bin.version;
  answer:=jsonb_build_object('id',bin.id,
    'status',CASE WHEN bin.active THEN 'active' ELSE 'closed' END,'version',bin.version,
    'warehouseId',bin.warehouse_id);

 ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown warehouse administration action';
 END CASE;

 INSERT INTO operations_warehouse_admin_events(tenant_id,aggregate_type,aggregate_id,aggregate_version,
   action,reason_en,reason_ar,evidence,actor_id,idempotency_key,request_payload,before_value,result)
 VALUES(c.tenant_id,aggregate_kind,aggregate,aggregate_version,payload->>'action',
   payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
   c.idempotency_key,payload,before_value,answer);
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,
   'operations_'||CASE aggregate_kind WHEN 'item' THEN 'inventory_items'
     WHEN 'warehouse' THEN 'warehouses' ELSE 'warehouse_bins' END,
   aggregate::text,c.actor_id,c.session_id,c.permission,c.request_id,c.idempotency_key,
   c.ip_address,c.user_agent,'allowed',c.reason,before_value,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_warehouse_admin_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_warehouse_admin_command(jsonb) TO orvex_runtime;
