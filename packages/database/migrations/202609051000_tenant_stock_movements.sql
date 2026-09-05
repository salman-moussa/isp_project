-- REQ-WHS-004: bin-level stock balances, partial receiving, transfers and controlled adjustments.
--
-- The catalog can already describe a non-serialized (bulk) SKU, but nothing could hold, receive,
-- move or count quantity: only serialized assets existed. This migration adds the quantity plane.
--
-- Serialized and non-serialized stock stay deliberately separate. A serialized unit is one row in
-- operations_serialized_assets with its own custody history; bulk stock is a quantity per
-- (item, warehouse, bin). Mixing the two into one counter would lose per-unit custody.
--
-- Valuation is standard cost: receipts use the purchase-order line cost, adjustments use the
-- item's configured unit cost for the stated currency. USD and LBP are held in separate accounts
-- and are never added together.

-- Inventory variance is where a counted difference or a write-off lands.
CREATE OR REPLACE FUNCTION seed_tenant_inventory_accounts(p_tenant_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO operations_chart_of_accounts(tenant_id,account_code,account_name_en,account_name_ar,account_type,currency,is_system)
  VALUES
    (p_tenant_id,'1300','Inventory USD','المخزون USD','asset','USD',true),
    (p_tenant_id,'1310','Inventory LBP','المخزون LBP','asset','LBP',true),
    (p_tenant_id,'5200','Inventory Variance & Write-off','فروقات وإتلاف المخزون','expense','ANY',true)
  ON CONFLICT(tenant_id,account_code) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION seed_tenant_inventory_accounts(uuid) FROM PUBLIC,orvex_runtime;

CREATE TABLE operations_stock_balances(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  bin_id uuid,
  quantity_on_hand integer NOT NULL DEFAULT 0 CHECK(quantity_on_hand>=0),
  quantity_reserved integer NOT NULL DEFAULT 0 CHECK(quantity_reserved>=0),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT stock_reserved_within_on_hand CHECK(quantity_reserved<=quantity_on_hand),
  FOREIGN KEY(tenant_id,item_id) REFERENCES operations_inventory_items(tenant_id,id),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  FOREIGN KEY(tenant_id,bin_id) REFERENCES operations_warehouse_bins(tenant_id,id),
  UNIQUE(tenant_id,id)
);

-- NULLS NOT DISTINCT so unbinned warehouse stock still collapses to a single row per item.
CREATE UNIQUE INDEX stock_balance_location ON operations_stock_balances(
  tenant_id,item_id,warehouse_id,bin_id) NULLS NOT DISTINCT;

CREATE TABLE operations_stock_movements(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN(
    'receipt','transfer_out','transfer_in','adjustment_increase','adjustment_decrease')),
  warehouse_id uuid NOT NULL,
  bin_id uuid,
  quantity integer NOT NULL CHECK(quantity>0 AND quantity<=1000000),
  unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>=0 AND unit_cost_minor<=9007199254740991),
  currency text NOT NULL CHECK(currency IN('USD','LBP')),
  purchase_order_line_id uuid,
  counterpart_movement_id uuid REFERENCES operations_stock_movements(id),
  journal_entry_id uuid,
  reason_en text NOT NULL CHECK(length(btrim(reason_en)) BETWEEN 8 AND 1000),
  reason_ar text NOT NULL CHECK(length(btrim(reason_ar)) BETWEEN 8 AND 1000),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 8 AND 2000),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  sequence integer NOT NULL CHECK(sequence>0),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  FOREIGN KEY(tenant_id,item_id) REFERENCES operations_inventory_items(tenant_id,id),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  FOREIGN KEY(tenant_id,bin_id) REFERENCES operations_warehouse_bins(tenant_id,id),
  FOREIGN KEY(tenant_id,purchase_order_line_id) REFERENCES operations_purchase_order_lines(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key,sequence),
  UNIQUE(tenant_id,id)
);
CREATE INDEX stock_movement_item ON operations_stock_movements(tenant_id,item_id,occurred_at DESC);

ALTER TABLE operations_purchase_orders DROP CONSTRAINT purchase_order_status;
ALTER TABLE operations_purchase_orders ADD CONSTRAINT purchase_order_status
  CHECK(status IN('draft','approved','partially_received','received','cancelled'));

ALTER TABLE operations_journal_entries DROP CONSTRAINT operations_journal_entries_source_type_check;
ALTER TABLE operations_journal_entries ADD CONSTRAINT operations_journal_entries_source_type_check
  CHECK(source_type IN('invoice','payment','credit_note','deposit','expense','manual','close',
    'inventory_receipt','inventory_adjustment'));

-- A purchase order can now be received in several instalments, so one journal per order is no
-- longer correct. Receipts are keyed by their own idempotency key instead.
DROP INDEX journal_inventory_receipt_once;
CREATE UNIQUE INDEX journal_inventory_source_once ON operations_journal_entries(tenant_id,idempotency_key)
  WHERE source_type IN('inventory_receipt','inventory_adjustment');

ALTER TABLE operations_stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_movements FORCE ROW LEVEL SECURITY;

-- A stock adjustment is signed by finance (tenant.accounting.post), which the inventory scope
-- functions did not previously recognise, so the adjusting session could not even read the item
-- or warehouse it was correcting. Both are extended for that one action only.
CREATE OR REPLACE FUNCTION inventory_catalog_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action='tenant.warehouse.stock.adjust')))
$$;

CREATE OR REPLACE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action='tenant.warehouse.stock.adjust'))
   AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
   AND (c.record_ids IS NULL OR (target_record IS NOT NULL AND target_record=ANY(c.record_ids))))
$$;

CREATE FUNCTION stock_location_scope_allows(target_tenant uuid,target_warehouse uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_warehouses w
  WHERE w.tenant_id=target_tenant AND w.id=target_warehouse
    AND inventory_warehouse_scope_allows(w.tenant_id,w.branch_id,w.id))
$$;
REVOKE ALL ON FUNCTION stock_location_scope_allows(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stock_location_scope_allows(uuid,uuid) TO orvex_runtime;

CREATE POLICY stock_balance_scope ON operations_stock_balances
  USING(stock_location_scope_allows(tenant_id,warehouse_id))
  WITH CHECK(stock_location_scope_allows(tenant_id,warehouse_id));
CREATE POLICY stock_movement_scope ON operations_stock_movements
  USING(stock_location_scope_allows(tenant_id,warehouse_id))
  WITH CHECK(stock_location_scope_allows(tenant_id,warehouse_id));

REVOKE ALL ON operations_stock_balances,operations_stock_movements FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_stock_balances,operations_stock_movements TO orvex_runtime;

CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON operations_stock_movements
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER stock_movement_no_truncate BEFORE TRUNCATE ON operations_stock_movements
 FOR EACH STATEMENT EXECUTE FUNCTION operations_reject_append_only_mutation();

-- Applies one signed quantity delta to a location, creating the balance row on first use.
CREATE FUNCTION apply_stock_delta(
  p_tenant uuid,p_item uuid,p_warehouse uuid,p_bin uuid,p_delta integer
) RETURNS operations_stock_balances
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE balance operations_stock_balances%ROWTYPE;
BEGIN
  INSERT INTO operations_stock_balances(tenant_id,item_id,warehouse_id,bin_id,quantity_on_hand)
  VALUES(p_tenant,p_item,p_warehouse,p_bin,0)
  ON CONFLICT(tenant_id,item_id,warehouse_id,bin_id) DO NOTHING;

  SELECT * INTO balance FROM operations_stock_balances
   WHERE tenant_id=p_tenant AND item_id=p_item AND warehouse_id=p_warehouse
     AND bin_id IS NOT DISTINCT FROM p_bin FOR UPDATE;

  IF balance.quantity_on_hand + p_delta < 0 THEN
    RAISE EXCEPTION USING ERRCODE='P4091',
      MESSAGE='insufficient stock at this location for the requested quantity';
  END IF;
  IF balance.quantity_on_hand + p_delta < balance.quantity_reserved THEN
    RAISE EXCEPTION USING ERRCODE='P4091',
      MESSAGE='this quantity is reserved and cannot be moved out';
  END IF;

  UPDATE operations_stock_balances
     SET quantity_on_hand=quantity_on_hand+p_delta,version=version+1,updated_at=clock_timestamp()
   WHERE id=balance.id RETURNING * INTO balance;
  RETURN balance;
END $$;
REVOKE ALL ON FUNCTION apply_stock_delta(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,orvex_runtime;

-- Posts a balanced two-line journal in a single currency. Never mixes USD and LBP.
CREATE FUNCTION post_inventory_journal(
  p_tenant uuid,p_actor uuid,p_source text,p_source_id uuid,p_key text,
  p_debit_code text,p_credit_code text,p_amount bigint,p_currency text,
  p_description_en text,p_description_ar text,p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE journal uuid;
BEGIN
  IF p_amount <= 0 THEN RETURN NULL; END IF;
  PERFORM seed_tenant_default_chart_of_accounts(p_tenant);
  PERFORM seed_tenant_inventory_accounts(p_tenant);
  INSERT INTO operations_journal_entries(tenant_id,entry_number,entry_date,description_en,description_ar,
    source_type,source_id,posted_by,posting_version,idempotency_key,request_payload)
  VALUES(p_tenant,upper(left(p_source,3))||'-'||p_key,(clock_timestamp() AT TIME ZONE 'UTC')::date,
    p_description_en,p_description_ar,p_source,p_source_id,p_actor,'v2',p_key,p_payload)
  RETURNING id INTO journal;
  INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,debit_minor,currency)
   SELECT journal,p_tenant,id,p_amount,p_currency FROM operations_chart_of_accounts
    WHERE tenant_id=p_tenant AND account_code=p_debit_code;
  INSERT INTO operations_journal_lines(journal_entry_id,tenant_id,account_id,credit_minor,currency)
   SELECT journal,p_tenant,id,p_amount,p_currency FROM operations_chart_of_accounts
    WHERE tenant_id=p_tenant AND account_code=p_credit_code;
  RETURN journal;
END $$;
REVOKE ALL ON FUNCTION post_inventory_journal(uuid,uuid,text,uuid,text,text,text,bigint,text,text,text,jsonb)
  FROM PUBLIC,orvex_runtime;

CREATE FUNCTION execute_stock_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_stock_movements%ROWTYPE;
 item operations_inventory_items%ROWTYPE; src operations_stock_balances%ROWTYPE;
 dst operations_stock_balances%ROWTYPE; from_wh operations_warehouses%ROWTYPE;
 to_wh operations_warehouses%ROWTYPE; quantity integer; unit_cost bigint; currency text;
 journal uuid; answer jsonb; out_id uuid; in_id uuid; from_bin uuid; to_bin uuid;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed tenant stock authority required';
 END IF;
 -- Moving stock is an operations action; writing value off is a finance action.
 IF (payload->>'action'='transfer_stock'
      AND (c.permission<>'tenant.installation.manage' OR c.action<>'tenant.warehouse.stock.transfer'))
   OR (payload->>'action'='adjust_stock'
      AND (c.permission<>'tenant.accounting.post' OR c.action<>'tenant.warehouse.stock.adjust')) THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize this stock command';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual stock evidence is required';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':stock:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_stock_movements
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key AND sequence=1;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='stock retry key belongs to different content';
  END IF;
  RETURN prior.result;
 END IF;

 quantity := (payload->>'quantity')::integer;
 IF quantity IS NULL OR quantity<=0 OR quantity>1000000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='stock quantity must be between 1 and 1000000';
 END IF;
 SELECT * INTO item FROM operations_inventory_items
  WHERE tenant_id=c.tenant_id AND id=(payload->>'itemId')::uuid FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='catalog item is outside the current scope'; END IF;
 IF item.serialized_flag THEN
  RAISE EXCEPTION USING ERRCODE='P4091',
   MESSAGE='serialized items move through custody transitions, not bulk stock movements'; END IF;

 CASE payload->>'action'
 WHEN 'transfer_stock' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','itemId','quantity','fromWarehouseId','fromBinId','toWarehouseId','toBinId',
     'reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock transfer field'; END IF;
  from_bin := nullif(payload->>'fromBinId','')::uuid;
  to_bin := nullif(payload->>'toBinId','')::uuid;
  SELECT * INTO from_wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'fromWarehouseId')::uuid FOR SHARE;
  SELECT * INTO to_wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'toWarehouseId')::uuid AND active FOR SHARE;
  IF from_wh.id IS NULL OR to_wh.id IS NULL
    OR NOT stock_location_scope_allows(c.tenant_id,from_wh.id)
    OR NOT stock_location_scope_allows(c.tenant_id,to_wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='a transfer endpoint is outside the current scope'; END IF;
  IF from_wh.id=to_wh.id AND from_bin IS NOT DISTINCT FROM to_bin THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='source and destination locations are identical'; END IF;
  IF from_bin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_warehouse_bins b
    WHERE b.tenant_id=c.tenant_id AND b.id=from_bin AND b.warehouse_id=from_wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='source bin does not belong to the source warehouse'; END IF;
  IF to_bin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_warehouse_bins b
    WHERE b.tenant_id=c.tenant_id AND b.id=to_bin AND b.warehouse_id=to_wh.id AND b.active) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='destination bin is unavailable for this warehouse'; END IF;

  -- Deterministic lock order keeps concurrent opposite transfers from deadlocking.
  IF (from_wh.id::text||coalesce(from_bin::text,'')) < (to_wh.id::text||coalesce(to_bin::text,'')) THEN
   src := apply_stock_delta(c.tenant_id,item.id,from_wh.id,from_bin,-quantity);
   dst := apply_stock_delta(c.tenant_id,item.id,to_wh.id,to_bin,quantity);
  ELSE
   dst := apply_stock_delta(c.tenant_id,item.id,to_wh.id,to_bin,quantity);
   src := apply_stock_delta(c.tenant_id,item.id,from_wh.id,from_bin,-quantity);
  END IF;

  currency := CASE WHEN item.unit_cost_minor_usd>0 THEN 'USD' ELSE 'LBP' END;
  unit_cost := CASE WHEN item.unit_cost_minor_usd>0 THEN item.unit_cost_minor_usd ELSE item.unit_cost_minor_lbp END;
  -- Movement ids are chosen before insert so the stored result is final. The append-only
  -- trigger forbids a follow-up UPDATE to fill it in.
  out_id := gen_random_uuid();
  in_id := gen_random_uuid();
  answer := jsonb_build_object('action','transfer_stock','quantity',quantity,
    'fromQuantityOnHand',src.quantity_on_hand,'toQuantityOnHand',dst.quantity_on_hand,
    'movementOutId',out_id,'movementInId',in_id);
  -- A transfer relocates value, it does not change it, so no journal is posted.
  INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
    unit_cost_minor,currency,reason_en,reason_ar,evidence,actor_id,idempotency_key,sequence,
    request_payload,result)
  VALUES(out_id,c.tenant_id,item.id,'transfer_out',from_wh.id,from_bin,quantity,unit_cost,currency,
    payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
    c.idempotency_key,1,payload,answer);
  INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
    unit_cost_minor,currency,counterpart_movement_id,reason_en,reason_ar,evidence,actor_id,
    idempotency_key,sequence,request_payload,result)
  VALUES(in_id,c.tenant_id,item.id,'transfer_in',to_wh.id,to_bin,quantity,unit_cost,currency,out_id,
    payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
    c.idempotency_key,2,payload,answer);

 WHEN 'adjust_stock' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','itemId','quantity','warehouseId','binId','direction','currency',
     'reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock adjustment field'; END IF;
  IF payload->>'direction' NOT IN('increase','decrease') THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='adjustment direction must be increase or decrease'; END IF;
  currency := payload->>'currency';
  IF currency NOT IN('USD','LBP') THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='adjustment currency must be USD or LBP'; END IF;
  to_bin := nullif(payload->>'binId','')::uuid;
  SELECT * INTO to_wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'warehouseId')::uuid FOR SHARE;
  IF to_wh.id IS NULL OR NOT stock_location_scope_allows(c.tenant_id,to_wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='warehouse is outside the current scope'; END IF;
  IF to_bin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_warehouse_bins b
    WHERE b.tenant_id=c.tenant_id AND b.id=to_bin AND b.warehouse_id=to_wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='bin does not belong to this warehouse'; END IF;

  unit_cost := CASE currency WHEN 'USD' THEN item.unit_cost_minor_usd ELSE item.unit_cost_minor_lbp END;
  dst := apply_stock_delta(c.tenant_id,item.id,to_wh.id,to_bin,
    CASE payload->>'direction' WHEN 'increase' THEN quantity ELSE -quantity END);

  journal := post_inventory_journal(c.tenant_id,c.actor_id::uuid,'inventory_adjustment',dst.id,
    c.idempotency_key,
    CASE payload->>'direction' WHEN 'increase'
      THEN CASE currency WHEN 'LBP' THEN '1310' ELSE '1300' END ELSE '5200' END,
    CASE payload->>'direction' WHEN 'increase'
      THEN '5200' ELSE CASE currency WHEN 'LBP' THEN '1310' ELSE '1300' END END,
    unit_cost*quantity,currency,
    'Inventory adjustment '||item.sku,'تسوية مخزون '||item.sku,payload);

  out_id := gen_random_uuid();
  answer := jsonb_build_object('action','adjust_stock','direction',payload->>'direction',
    'quantity',quantity,'quantityOnHand',dst.quantity_on_hand,'movementId',out_id,
    'journalId',journal,'currency',currency);
  INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
    unit_cost_minor,currency,journal_entry_id,reason_en,reason_ar,evidence,actor_id,
    idempotency_key,sequence,request_payload,result)
  VALUES(out_id,c.tenant_id,item.id,
    CASE payload->>'direction' WHEN 'increase' THEN 'adjustment_increase' ELSE 'adjustment_decrease' END,
    to_wh.id,to_bin,quantity,unit_cost,currency,journal,
    payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
    c.idempotency_key,1,payload,answer);

 ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock action';
 END CASE;

 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_stock_balances',coalesce(dst.id,src.id)::text,c.actor_id,
   c.session_id,c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,
   'allowed',c.reason,NULL,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_stock_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_stock_command(jsonb) TO orvex_runtime;

-- Replaces the 202609021811 definition so a purchase order can carry non-serialized lines and be
-- received in instalments. The original required every outstanding serialized unit in one receipt
-- and posted the whole order value at once, which is wrong as soon as a supplier part-ships.
-- Migration 1811 itself is untouched: it is applied and immutable.
CREATE OR REPLACE FUNCTION execute_procurement_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_procurement_events%ROWTYPE;
 vendor operations_procurement_vendors%ROWTYPE; po operations_purchase_orders%ROWTYPE;
 wh operations_warehouses%ROWTYPE; line record; asset jsonb; answer jsonb; before_value jsonb;
 total bigint:=0; received_value bigint:=0; journal uuid; aggregate uuid; aggregate_version integer:=1;
 taken integer; outstanding integer; receipt_bin uuid; balance operations_stock_balances%ROWTYPE;
 remaining integer; sequence_no integer:=0;
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
   -- Both serialized and bulk items are orderable; the receipt path differs, not the order.
   IF NOT EXISTS(SELECT 1 FROM operations_inventory_items i WHERE i.tenant_id=c.tenant_id
      AND i.id=(line.value->>'itemId')::uuid AND i.active) THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='purchase order lines require an active catalog item'; END IF;
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
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','purchaseOrderId','expectedVersion','assets','quantities','binId',
     'reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown receiving field'; END IF;
  IF coalesce(jsonb_array_length(payload->'assets'),0)+coalesce(jsonb_array_length(payload->'quantities'),0)=0 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a receipt must record at least one serialized unit or quantity'; END IF;
  IF coalesce(jsonb_array_length(payload->'assets'),0)>500
    OR coalesce(jsonb_array_length(payload->'quantities'),0)>100 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='receipt exceeds the supported size'; END IF;
  SELECT * INTO po FROM operations_purchase_orders WHERE tenant_id=c.tenant_id
   AND id=(payload->>'purchaseOrderId')::uuid FOR UPDATE;
  IF po.id IS NULL OR po.status NOT IN('approved','partially_received') OR po.approved_by IS NULL
    OR po.vendor_id IS NULL OR po.warehouse_id IS NULL
    OR po.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='purchase order changed or is not receivable'; END IF;
  IF NOT procurement_order_scope_allows(c.tenant_id,po.id,po.branch_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='purchase order is outside the current scope'; END IF;
  before_value:=to_jsonb(po);
  receipt_bin := nullif(payload->>'binId','')::uuid;
  IF receipt_bin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_warehouse_bins b
    WHERE b.tenant_id=c.tenant_id AND b.id=receipt_bin AND b.warehouse_id=po.warehouse_id AND b.active) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='receiving bin is unavailable for this warehouse'; END IF;

  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'assets','[]'::jsonb)) a
    LEFT JOIN operations_purchase_order_lines l ON l.tenant_id=c.tenant_id
      AND l.purchase_order_id=po.id AND l.id=(a->>'lineId')::uuid WHERE l.id IS NULL)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'quantities','[]'::jsonb)) q
    LEFT JOIN operations_purchase_order_lines l ON l.tenant_id=c.tenant_id
      AND l.purchase_order_id=po.id AND l.id=(q->>'lineId')::uuid WHERE l.id IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='receipt references a line outside this purchase order'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(payload->'assets','[]'::jsonb)))
     <> (SELECT count(DISTINCT a->>'serialNumber') FROM jsonb_array_elements(coalesce(payload->'assets','[]'::jsonb)) a) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='receipt contains a duplicate serial number'; END IF;

  FOR line IN SELECT l.*,i.serialized_flag,i.sku FROM operations_purchase_order_lines l
    JOIN operations_inventory_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id
    WHERE l.tenant_id=c.tenant_id AND l.purchase_order_id=po.id ORDER BY l.line_number LOOP
   outstanding := line.quantity - line.received_quantity;
   IF line.serialized_flag THEN
    SELECT count(*)::integer INTO taken FROM jsonb_array_elements(coalesce(payload->'assets','[]'::jsonb)) a
     WHERE (a->>'lineId')::uuid=line.id;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'quantities','[]'::jsonb)) q
      WHERE (q->>'lineId')::uuid=line.id) THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='serialized lines are received by serial number, not quantity'; END IF;
   ELSE
    SELECT coalesce(sum((q->>'quantity')::integer),0)::integer INTO taken
     FROM jsonb_array_elements(coalesce(payload->'quantities','[]'::jsonb)) q
     WHERE (q->>'lineId')::uuid=line.id;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'assets','[]'::jsonb)) a
      WHERE (a->>'lineId')::uuid=line.id) THEN
     RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='bulk lines are received by quantity, not serial number'; END IF;
   END IF;
   IF taken<0 OR taken>outstanding THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='a receipt line exceeds the outstanding quantity'; END IF;
   IF taken=0 THEN CONTINUE; END IF;

   received_value := received_value + (taken::bigint * line.unit_cost_minor);
   IF line.serialized_flag THEN
    FOR asset IN SELECT value FROM jsonb_array_elements(payload->'assets') WHERE (value->>'lineId')::uuid=line.id LOOP
     INSERT INTO operations_serialized_assets(tenant_id,item_id,serial_number,mac_address,warehouse_id,
       status,purchase_order_id,purchase_order_line_id)
     VALUES(c.tenant_id,line.item_id,btrim(asset->>'serialNumber'),nullif(btrim(asset->>'macAddress'),''),
       po.warehouse_id,'in_stock',po.id,line.id);
    END LOOP;
   ELSE
    balance := apply_stock_delta(c.tenant_id,line.item_id,po.warehouse_id,receipt_bin,taken);
    sequence_no := sequence_no + 1;
    INSERT INTO operations_stock_movements(tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
      unit_cost_minor,currency,purchase_order_line_id,reason_en,reason_ar,evidence,actor_id,
      idempotency_key,sequence,request_payload,result)
    VALUES(c.tenant_id,line.item_id,'receipt',po.warehouse_id,receipt_bin,taken,line.unit_cost_minor,
      po.currency,line.id,payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',
      c.actor_id::uuid,c.idempotency_key,sequence_no,payload,
      jsonb_build_object('quantityOnHand',balance.quantity_on_hand));
   END IF;
   UPDATE operations_purchase_order_lines SET received_quantity=received_quantity+taken
    WHERE tenant_id=c.tenant_id AND id=line.id;
  END LOOP;

  SELECT count(*)::integer INTO remaining FROM operations_purchase_order_lines l
   WHERE l.tenant_id=c.tenant_id AND l.purchase_order_id=po.id AND l.received_quantity<l.quantity;
  UPDATE operations_purchase_orders
     SET status=CASE WHEN remaining=0 THEN 'received' ELSE 'partially_received' END,
         received_at=CASE WHEN remaining=0 THEN clock_timestamp() ELSE received_at END,
         version=version+1
   WHERE id=po.id RETURNING * INTO po;

  -- Only the value actually received is posted, so a part-shipment never overstates payables.
  journal := post_inventory_journal(c.tenant_id,c.actor_id::uuid,'inventory_receipt',po.id,
    c.idempotency_key,
    CASE po.currency WHEN 'LBP' THEN '1310' ELSE '1300' END,
    CASE po.currency WHEN 'LBP' THEN '2110' ELSE '2100' END,
    received_value,po.currency,
    'Inventory receipt '||po.po_number,'استلام مخزون '||po.po_number,payload);

  aggregate:=po.id; aggregate_version:=po.version;
  answer:=jsonb_build_object('id',po.id,'status',po.status,'version',po.version,
    'journalId',journal,'receivedValueMinor',received_value,'linesOutstanding',remaining);
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
