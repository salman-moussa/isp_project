-- REQ-WHS-005: stock reservations and material consumption against field work.
--
-- Bulk stock could be received, moved and adjusted, but nothing could hold quantity for a job or
-- record that a technician consumed it. operations_stock_balances already carried a
-- quantity_reserved column enforced against quantity_on_hand; this migration is what finally sets
-- it, through an auditable reservation with its own lifecycle.
--
-- Consumption is where inventory becomes cost: it decrements on hand and posts the consumed value
-- from Inventory to Network Operating Expense. A release does not, because nothing was used.

CREATE TABLE operations_stock_reservations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  bin_id uuid,
  quantity integer NOT NULL CHECK(quantity>0 AND quantity<=1000000),
  status text NOT NULL DEFAULT 'held' CHECK(status IN('held','released','consumed')),
  installation_id uuid,
  reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 2 AND 200),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CONSTRAINT reservation_resolved_when_final
    CHECK((status='held' AND resolved_at IS NULL) OR (status<>'held' AND resolved_at IS NOT NULL)),
  FOREIGN KEY(tenant_id,item_id) REFERENCES operations_inventory_items(tenant_id,id),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  FOREIGN KEY(tenant_id,bin_id) REFERENCES operations_warehouse_bins(tenant_id,id),
  FOREIGN KEY(tenant_id,installation_id) REFERENCES operations_installations(tenant_id,id),
  UNIQUE(tenant_id,id)
);
CREATE INDEX stock_reservation_open ON operations_stock_reservations(tenant_id,item_id,warehouse_id)
  WHERE status='held';

ALTER TABLE operations_stock_movements DROP CONSTRAINT operations_stock_movements_kind_check;
ALTER TABLE operations_stock_movements ADD CONSTRAINT operations_stock_movements_kind_check
  CHECK(kind IN('receipt','transfer_out','transfer_in','adjustment_increase','adjustment_decrease',
    'reservation_hold','reservation_release','consumption'));

ALTER TABLE operations_stock_movements
  ADD COLUMN reservation_id uuid,
  ADD CONSTRAINT stock_movement_reservation_tenant FOREIGN KEY(tenant_id,reservation_id)
    REFERENCES operations_stock_reservations(tenant_id,id);

ALTER TABLE operations_journal_entries DROP CONSTRAINT operations_journal_entries_source_type_check;
ALTER TABLE operations_journal_entries ADD CONSTRAINT operations_journal_entries_source_type_check
  CHECK(source_type IN('invoice','payment','credit_note','deposit','expense','manual','close',
    'inventory_receipt','inventory_adjustment','inventory_consumption'));

DROP INDEX journal_inventory_source_once;
CREATE UNIQUE INDEX journal_inventory_source_once ON operations_journal_entries(tenant_id,idempotency_key)
  WHERE source_type IN('inventory_receipt','inventory_adjustment','inventory_consumption');

ALTER TABLE operations_stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_reservation_scope ON operations_stock_reservations
  USING(stock_location_scope_allows(tenant_id,warehouse_id))
  WITH CHECK(stock_location_scope_allows(tenant_id,warehouse_id));

REVOKE ALL ON operations_stock_reservations FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_stock_reservations TO orvex_runtime;

CREATE TRIGGER stock_reservation_no_delete BEFORE DELETE ON operations_stock_reservations
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

-- Adjusts the reserved counter on a location. The balance table already refuses a reservation
-- larger than what is on hand, and refuses moving out stock that is reserved.
CREATE FUNCTION apply_reservation_delta(
  p_tenant uuid,p_item uuid,p_warehouse uuid,p_bin uuid,p_delta integer
) RETURNS operations_stock_balances
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE balance operations_stock_balances%ROWTYPE;
BEGIN
  SELECT * INTO balance FROM operations_stock_balances
   WHERE tenant_id=p_tenant AND item_id=p_item AND warehouse_id=p_warehouse
     AND bin_id IS NOT DISTINCT FROM p_bin FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='no stock is held at this location';
  END IF;
  IF balance.quantity_reserved + p_delta < 0 THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='reservation release exceeds the reserved quantity';
  END IF;
  IF balance.quantity_reserved + p_delta > balance.quantity_on_hand THEN
    RAISE EXCEPTION USING ERRCODE='P4091',
      MESSAGE='not enough unreserved stock at this location for the requested reservation';
  END IF;
  UPDATE operations_stock_balances
     SET quantity_reserved=quantity_reserved+p_delta,version=version+1,updated_at=clock_timestamp()
   WHERE id=balance.id RETURNING * INTO balance;
  RETURN balance;
END $$;
REVOKE ALL ON FUNCTION apply_reservation_delta(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,orvex_runtime;

CREATE FUNCTION execute_stock_reservation_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_stock_movements%ROWTYPE;
 item operations_inventory_items%ROWTYPE; wh operations_warehouses%ROWTYPE;
 inst operations_installations%ROWTYPE; reservation operations_stock_reservations%ROWTYPE;
 balance operations_stock_balances%ROWTYPE; quantity integer; unit_cost bigint; currency text;
 journal uuid; answer jsonb; movement uuid; target_bin uuid;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
   OR c.permission<>'tenant.installation.manage'
   OR c.action<>'tenant.warehouse.stock.reserve' THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed stock reservation authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual reservation evidence is required';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':reservation:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_stock_movements
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key AND sequence=1;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='reservation retry key belongs to different content';
  END IF;
  RETURN prior.result;
 END IF;

 CASE payload->>'action'
 WHEN 'reserve_stock' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','itemId','quantity','warehouseId','binId','installationId','reference',
     'reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown reservation field'; END IF;
  quantity := (payload->>'quantity')::integer;
  IF quantity IS NULL OR quantity<=0 OR quantity>1000000 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='reservation quantity must be between 1 and 1000000'; END IF;
  SELECT * INTO item FROM operations_inventory_items
   WHERE tenant_id=c.tenant_id AND id=(payload->>'itemId')::uuid FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='catalog item is outside the current scope'; END IF;
  IF item.serialized_flag THEN
   RAISE EXCEPTION USING ERRCODE='P4091',
    MESSAGE='serialized equipment is held through custody, not a bulk reservation'; END IF;
  target_bin := nullif(payload->>'binId','')::uuid;
  SELECT * INTO wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'warehouseId')::uuid FOR SHARE;
  IF wh.id IS NULL OR NOT stock_location_scope_allows(c.tenant_id,wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='warehouse is outside the current scope'; END IF;
  IF target_bin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_warehouse_bins b
    WHERE b.tenant_id=c.tenant_id AND b.id=target_bin AND b.warehouse_id=wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='bin does not belong to this warehouse'; END IF;
  IF payload->>'installationId' IS NOT NULL THEN
   SELECT * INTO inst FROM operations_installations WHERE tenant_id=c.tenant_id
    AND id=(payload->>'installationId')::uuid FOR SHARE;
   IF NOT FOUND OR NOT operations_scope_allows_installation(c.tenant_id,inst.id) THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='installation is outside the current scope'; END IF;
   IF inst.status NOT IN('scheduled','in_progress','ready_for_activation') THEN
    RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='stock can only be held for active field work'; END IF;
  END IF;

  balance := apply_reservation_delta(c.tenant_id,item.id,wh.id,target_bin,quantity);
  INSERT INTO operations_stock_reservations(tenant_id,item_id,warehouse_id,bin_id,quantity,
    installation_id,reference)
  VALUES(c.tenant_id,item.id,wh.id,target_bin,quantity,
    nullif(payload->>'installationId','')::uuid,btrim(payload->>'reference'))
  RETURNING * INTO reservation;
  movement := gen_random_uuid();
  answer := jsonb_build_object('action','reserve_stock','reservationId',reservation.id,
    'status','held','version',reservation.version,'quantity',quantity,
    'quantityReserved',balance.quantity_reserved,'quantityOnHand',balance.quantity_on_hand,
    'movementId',movement);
  INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
    unit_cost_minor,currency,reservation_id,reason_en,reason_ar,evidence,actor_id,
    idempotency_key,sequence,request_payload,result)
  VALUES(movement,c.tenant_id,item.id,'reservation_hold',wh.id,target_bin,quantity,
    CASE WHEN item.unit_cost_minor_usd>0 THEN item.unit_cost_minor_usd ELSE item.unit_cost_minor_lbp END,
    CASE WHEN item.unit_cost_minor_usd>0 THEN 'USD' ELSE 'LBP' END,reservation.id,
    payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
    c.idempotency_key,1,payload,answer);

 WHEN 'release_reservation' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','reservationId','expectedVersion','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown reservation field'; END IF;
  SELECT * INTO reservation FROM operations_stock_reservations
   WHERE tenant_id=c.tenant_id AND id=(payload->>'reservationId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT stock_location_scope_allows(c.tenant_id,reservation.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='reservation is outside the current scope'; END IF;
  IF reservation.status<>'held' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only a held reservation can be released'; END IF;
  IF reservation.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='reservation changed; refresh before acting'; END IF;
  SELECT * INTO item FROM operations_inventory_items
   WHERE tenant_id=c.tenant_id AND id=reservation.item_id FOR SHARE;

  balance := apply_reservation_delta(c.tenant_id,reservation.item_id,reservation.warehouse_id,
    reservation.bin_id,-reservation.quantity);
  UPDATE operations_stock_reservations SET status='released',resolved_at=clock_timestamp(),
    version=version+1 WHERE id=reservation.id RETURNING * INTO reservation;
  movement := gen_random_uuid();
  -- Nothing was used, so no value leaves inventory and no journal is posted.
  answer := jsonb_build_object('action','release_reservation','reservationId',reservation.id,
    'status',reservation.status,'version',reservation.version,'quantity',reservation.quantity,
    'quantityReserved',balance.quantity_reserved,'quantityOnHand',balance.quantity_on_hand,
    'movementId',movement);
  INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
    unit_cost_minor,currency,reservation_id,reason_en,reason_ar,evidence,actor_id,
    idempotency_key,sequence,request_payload,result)
  VALUES(movement,c.tenant_id,reservation.item_id,'reservation_release',reservation.warehouse_id,
    reservation.bin_id,reservation.quantity,
    CASE WHEN item.unit_cost_minor_usd>0 THEN item.unit_cost_minor_usd ELSE item.unit_cost_minor_lbp END,
    CASE WHEN item.unit_cost_minor_usd>0 THEN 'USD' ELSE 'LBP' END,reservation.id,
    payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
    c.idempotency_key,1,payload,answer);

 WHEN 'consume_reservation' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','reservationId','expectedVersion','quantity','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown reservation field'; END IF;
  SELECT * INTO reservation FROM operations_stock_reservations
   WHERE tenant_id=c.tenant_id AND id=(payload->>'reservationId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT stock_location_scope_allows(c.tenant_id,reservation.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='reservation is outside the current scope'; END IF;
  IF reservation.status<>'held' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only a held reservation can be consumed'; END IF;
  IF reservation.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='reservation changed; refresh before acting'; END IF;
  quantity := coalesce((payload->>'quantity')::integer,reservation.quantity);
  IF quantity<=0 OR quantity>reservation.quantity THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='consumed quantity exceeds the reservation'; END IF;
  SELECT * INTO item FROM operations_inventory_items
   WHERE tenant_id=c.tenant_id AND id=reservation.item_id FOR SHARE;
  currency := CASE WHEN item.unit_cost_minor_usd>0 THEN 'USD' ELSE 'LBP' END;
  unit_cost := CASE WHEN item.unit_cost_minor_usd>0 THEN item.unit_cost_minor_usd ELSE item.unit_cost_minor_lbp END;

  -- Release the whole hold, then remove only what was actually used from stock. Any unused
  -- remainder returns to free stock rather than silently staying reserved.
  balance := apply_reservation_delta(c.tenant_id,reservation.item_id,reservation.warehouse_id,
    reservation.bin_id,-reservation.quantity);
  balance := apply_stock_delta(c.tenant_id,reservation.item_id,reservation.warehouse_id,
    reservation.bin_id,-quantity);
  UPDATE operations_stock_reservations SET status='consumed',resolved_at=clock_timestamp(),
    version=version+1 WHERE id=reservation.id RETURNING * INTO reservation;

  -- Consumption is where inventory becomes cost.
  journal := post_inventory_journal(c.tenant_id,c.actor_id::uuid,'inventory_consumption',
    reservation.id,c.idempotency_key,'5000',
    CASE currency WHEN 'LBP' THEN '1310' ELSE '1300' END,
    unit_cost*quantity,currency,
    'Material consumption '||item.sku,'استهلاك مواد '||item.sku,payload);

  movement := gen_random_uuid();
  answer := jsonb_build_object('action','consume_reservation','reservationId',reservation.id,
    'status',reservation.status,'version',reservation.version,'quantity',quantity,
    'quantityReserved',balance.quantity_reserved,'quantityOnHand',balance.quantity_on_hand,
    'journalId',journal,'currency',currency,'movementId',movement);
  INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
    unit_cost_minor,currency,reservation_id,journal_entry_id,reason_en,reason_ar,evidence,actor_id,
    idempotency_key,sequence,request_payload,result)
  VALUES(movement,c.tenant_id,reservation.item_id,'consumption',reservation.warehouse_id,
    reservation.bin_id,quantity,unit_cost,currency,reservation.id,journal,
    payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
    c.idempotency_key,1,payload,answer);

 ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown reservation action';
 END CASE;

 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_stock_reservations',reservation.id::text,c.actor_id,
   c.session_id,c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,
   'allowed',c.reason,NULL,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_stock_reservation_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_stock_reservation_command(jsonb) TO orvex_runtime;
