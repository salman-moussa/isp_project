-- REQ-WHS-006: controlled stock counts with variance posting.
--
-- Adjustments already existed, but a real count is not a series of ad-hoc adjustments: it is a
-- session that snapshots what the system believed at a point in time, records what was physically
-- found, and posts the difference once, under finance authority.
--
-- Opening and counting are warehouse work. Closing moves money, so it carries finance authority
-- and step-up, exactly like a discretionary adjustment.

CREATE TABLE operations_stock_counts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  count_number text NOT NULL CHECK(length(btrim(count_number)) BETWEEN 2 AND 80),
  warehouse_id uuid NOT NULL,
  bin_id uuid,
  -- Declared up front so every line is valued in one currency; USD and LBP never combine.
  currency text NOT NULL CHECK(currency IN('USD','LBP')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','closed','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  opened_by uuid NOT NULL REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz,
  journal_entry_id uuid,
  CONSTRAINT count_closed_when_final
    CHECK((status='open' AND closed_at IS NULL) OR (status<>'open' AND closed_at IS NOT NULL)),
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  FOREIGN KEY(tenant_id,bin_id) REFERENCES operations_warehouse_bins(tenant_id,id),
  UNIQUE(tenant_id,count_number),
  UNIQUE(tenant_id,id)
);
-- One open count per location at a time: two concurrent counts of the same shelf cannot both be
-- trusted, and their closes would fight over the same balances.
CREATE UNIQUE INDEX stock_count_single_open ON operations_stock_counts(tenant_id,warehouse_id,bin_id)
  NULLS NOT DISTINCT WHERE status='open';

CREATE TABLE operations_stock_count_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  count_id uuid NOT NULL,
  item_id uuid NOT NULL,
  -- What the system believed when the count was opened, frozen for comparison.
  system_quantity integer NOT NULL CHECK(system_quantity>=0),
  counted_quantity integer CHECK(counted_quantity>=0 AND counted_quantity<=10000000),
  unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>=0),
  variance integer GENERATED ALWAYS AS (counted_quantity - system_quantity) STORED,
  counted_at timestamptz,
  FOREIGN KEY(tenant_id,count_id) REFERENCES operations_stock_counts(tenant_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES operations_inventory_items(tenant_id,id),
  UNIQUE(tenant_id,count_id,item_id),
  UNIQUE(tenant_id,id)
);

ALTER TABLE operations_stock_movements DROP CONSTRAINT operations_stock_movements_kind_check;
ALTER TABLE operations_stock_movements ADD CONSTRAINT operations_stock_movements_kind_check
  CHECK(kind IN('receipt','transfer_out','transfer_in','adjustment_increase','adjustment_decrease',
    'reservation_hold','reservation_release','consumption','count_increase','count_decrease'));

ALTER TABLE operations_stock_movements
  ADD COLUMN stock_count_id uuid,
  ADD CONSTRAINT stock_movement_count_tenant FOREIGN KEY(tenant_id,stock_count_id)
    REFERENCES operations_stock_counts(tenant_id,id);

ALTER TABLE operations_journal_entries DROP CONSTRAINT operations_journal_entries_source_type_check;
ALTER TABLE operations_journal_entries ADD CONSTRAINT operations_journal_entries_source_type_check
  CHECK(source_type IN('invoice','payment','credit_note','deposit','expense','manual','close',
    'inventory_receipt','inventory_adjustment','inventory_consumption','inventory_count'));

DROP INDEX journal_inventory_source_once;
CREATE UNIQUE INDEX journal_inventory_source_once ON operations_journal_entries(tenant_id,idempotency_key)
  WHERE source_type IN('inventory_receipt','inventory_adjustment','inventory_consumption','inventory_count');

ALTER TABLE operations_stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_counts FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_stock_count_lines FORCE ROW LEVEL SECURITY;

-- Counting is warehouse work; closing posts variance, so finance may reach the same rows.
CREATE OR REPLACE FUNCTION inventory_catalog_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action IN(
       'tenant.warehouse.stock.adjust','tenant.warehouse.stock.count.close'))))
$$;

CREATE OR REPLACE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action IN(
       'tenant.warehouse.stock.adjust','tenant.warehouse.stock.count.close')))
   AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
   AND (c.record_ids IS NULL OR (target_record IS NOT NULL AND target_record=ANY(c.record_ids))))
$$;

CREATE POLICY stock_count_scope ON operations_stock_counts
  USING(stock_location_scope_allows(tenant_id,warehouse_id))
  WITH CHECK(stock_location_scope_allows(tenant_id,warehouse_id));
CREATE POLICY stock_count_line_scope ON operations_stock_count_lines
  USING(EXISTS(SELECT 1 FROM operations_stock_counts k
    WHERE k.tenant_id=operations_stock_count_lines.tenant_id
      AND k.id=operations_stock_count_lines.count_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_stock_counts k
    WHERE k.tenant_id=operations_stock_count_lines.tenant_id
      AND k.id=operations_stock_count_lines.count_id));

REVOKE ALL ON operations_stock_counts,operations_stock_count_lines FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_stock_counts,operations_stock_count_lines TO orvex_runtime;

CREATE TRIGGER stock_count_no_delete BEFORE DELETE ON operations_stock_counts
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();
CREATE TRIGGER stock_count_line_no_delete BEFORE DELETE ON operations_stock_count_lines
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

CREATE FUNCTION execute_stock_count_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_stock_counts%ROWTYPE;
 counted operations_stock_counts%ROWTYPE; wh operations_warehouses%ROWTYPE; line record;
 answer jsonb; target_bin uuid; seeded integer:=0; net_value bigint:=0; journal uuid;
 movement uuid; sequence_no integer:=0; adjusted integer:=0; counted_lines integer;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed tenant stock count authority required';
 END IF;
 -- Opening and recording are warehouse work; closing posts variance and is finance work.
 IF (payload->>'action' IN('open_count','record_count','cancel_count')
      AND (c.permission<>'tenant.installation.manage' OR c.action<>'tenant.warehouse.stock.count'))
   OR (payload->>'action'='close_count'
      AND (c.permission<>'tenant.accounting.post' OR c.action<>'tenant.warehouse.stock.count.close')) THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed action does not authorize this stock count command';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual stock count evidence is required';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':stockcount:'||c.idempotency_key,0));
 SELECT k.* INTO prior FROM operations_stock_counts k
  JOIN operations_stock_movements m ON m.tenant_id=k.tenant_id AND m.stock_count_id=k.id
  WHERE k.tenant_id=c.tenant_id AND m.idempotency_key=c.idempotency_key LIMIT 1;

 CASE payload->>'action'
 WHEN 'open_count' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','countNumber','warehouseId','binId','currency','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock count field'; END IF;
  IF payload->>'currency' NOT IN('USD','LBP') THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='count valuation currency must be USD or LBP'; END IF;
  target_bin := nullif(payload->>'binId','')::uuid;
  SELECT * INTO wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'warehouseId')::uuid FOR SHARE;
  IF wh.id IS NULL OR NOT stock_location_scope_allows(c.tenant_id,wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='warehouse is outside the current scope'; END IF;
  IF target_bin IS NOT NULL AND NOT EXISTS(SELECT 1 FROM operations_warehouse_bins b
    WHERE b.tenant_id=c.tenant_id AND b.id=target_bin AND b.warehouse_id=wh.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='bin does not belong to this warehouse'; END IF;
  IF EXISTS(SELECT 1 FROM operations_stock_counts k WHERE k.tenant_id=c.tenant_id
    AND k.warehouse_id=wh.id AND k.bin_id IS NOT DISTINCT FROM target_bin AND k.status='open') THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='a count is already open for this location'; END IF;

  INSERT INTO operations_stock_counts(tenant_id,count_number,warehouse_id,bin_id,currency,opened_by)
  VALUES(c.tenant_id,btrim(payload->>'countNumber'),wh.id,target_bin,payload->>'currency',c.actor_id::uuid)
  RETURNING * INTO counted;

  -- Freeze what the system believes right now, valued in the declared currency.
  INSERT INTO operations_stock_count_lines(tenant_id,count_id,item_id,system_quantity,unit_cost_minor)
   SELECT c.tenant_id,counted.id,b.item_id,b.quantity_on_hand,
     CASE counted.currency WHEN 'USD' THEN i.unit_cost_minor_usd ELSE i.unit_cost_minor_lbp END
   FROM operations_stock_balances b
   JOIN operations_inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id
   WHERE b.tenant_id=c.tenant_id AND b.warehouse_id=wh.id
     AND (target_bin IS NULL OR b.bin_id=target_bin);
  GET DIAGNOSTICS seeded = ROW_COUNT;
  answer := jsonb_build_object('action','open_count','countId',counted.id,'status','open',
    'version',counted.version,'lines',seeded,'currency',counted.currency);

 WHEN 'record_count' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','countId','expectedVersion','lines','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock count field'; END IF;
  IF jsonb_typeof(payload->'lines') IS DISTINCT FROM 'array'
    OR jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a count entry requires 1 to 500 lines'; END IF;
  SELECT * INTO counted FROM operations_stock_counts
   WHERE tenant_id=c.tenant_id AND id=(payload->>'countId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT stock_location_scope_allows(c.tenant_id,counted.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='stock count is outside the current scope'; END IF;
  IF counted.status<>'open' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open count can record quantities'; END IF;
  IF counted.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='stock count changed; refresh before recording'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'lines') l
    LEFT JOIN operations_stock_count_lines k ON k.tenant_id=c.tenant_id
      AND k.count_id=counted.id AND k.id=(l->>'lineId')::uuid WHERE k.id IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a counted line does not belong to this count'; END IF;

  UPDATE operations_stock_count_lines k
     SET counted_quantity=(l.value->>'countedQuantity')::integer,counted_at=clock_timestamp()
    FROM jsonb_array_elements(payload->'lines') AS l(value)
   WHERE k.tenant_id=c.tenant_id AND k.count_id=counted.id AND k.id=(l.value->>'lineId')::uuid;
  UPDATE operations_stock_counts SET version=version+1 WHERE id=counted.id RETURNING * INTO counted;
  SELECT count(*)::integer INTO counted_lines FROM operations_stock_count_lines
   WHERE tenant_id=c.tenant_id AND count_id=counted.id AND counted_quantity IS NOT NULL;
  answer := jsonb_build_object('action','record_count','countId',counted.id,'status',counted.status,
    'version',counted.version,'countedLines',counted_lines);

 WHEN 'cancel_count' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','countId','expectedVersion','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock count field'; END IF;
  SELECT * INTO counted FROM operations_stock_counts
   WHERE tenant_id=c.tenant_id AND id=(payload->>'countId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT stock_location_scope_allows(c.tenant_id,counted.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='stock count is outside the current scope'; END IF;
  IF counted.status<>'open' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open count can be cancelled'; END IF;
  IF counted.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='stock count changed; refresh before acting'; END IF;
  UPDATE operations_stock_counts SET status='cancelled',closed_at=clock_timestamp(),
    closed_by=c.actor_id::uuid,version=version+1 WHERE id=counted.id RETURNING * INTO counted;
  -- Cancelling changes no balance and posts nothing.
  answer := jsonb_build_object('action','cancel_count','countId',counted.id,
    'status',counted.status,'version',counted.version);

 WHEN 'close_count' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','countId','expectedVersion','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock count field'; END IF;
  SELECT * INTO counted FROM operations_stock_counts
   WHERE tenant_id=c.tenant_id AND id=(payload->>'countId')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT stock_location_scope_allows(c.tenant_id,counted.warehouse_id) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='stock count is outside the current scope'; END IF;
  IF counted.status<>'open' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open count can be closed'; END IF;
  IF counted.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='stock count changed; refresh before closing'; END IF;
  IF EXISTS(SELECT 1 FROM operations_stock_count_lines
    WHERE tenant_id=c.tenant_id AND count_id=counted.id AND counted_quantity IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',
    MESSAGE='every line must be counted before the count can be closed'; END IF;

  FOR line IN SELECT * FROM operations_stock_count_lines
    WHERE tenant_id=c.tenant_id AND count_id=counted.id AND variance<>0 ORDER BY item_id LOOP
   PERFORM apply_stock_delta(c.tenant_id,line.item_id,counted.warehouse_id,counted.bin_id,line.variance);
   net_value := net_value + (line.variance::bigint * line.unit_cost_minor);
   adjusted := adjusted + 1;
   sequence_no := sequence_no + 1;
   movement := gen_random_uuid();
   INSERT INTO operations_stock_movements(id,tenant_id,item_id,kind,warehouse_id,bin_id,quantity,
     unit_cost_minor,currency,stock_count_id,reason_en,reason_ar,evidence,actor_id,
     idempotency_key,sequence,request_payload,result)
   VALUES(movement,c.tenant_id,line.item_id,
     CASE WHEN line.variance>0 THEN 'count_increase' ELSE 'count_decrease' END,
     counted.warehouse_id,counted.bin_id,abs(line.variance),line.unit_cost_minor,counted.currency,
     counted.id,payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
     c.idempotency_key,sequence_no,payload,
     jsonb_build_object('lineId',line.id,'variance',line.variance));
  END LOOP;

  -- One journal for the whole count, netted in its declared currency.
  IF net_value <> 0 THEN
   journal := post_inventory_journal(c.tenant_id,c.actor_id::uuid,'inventory_count',counted.id,
     c.idempotency_key,
     CASE WHEN net_value>0 THEN CASE counted.currency WHEN 'LBP' THEN '1310' ELSE '1300' END ELSE '5200' END,
     CASE WHEN net_value>0 THEN '5200' ELSE CASE counted.currency WHEN 'LBP' THEN '1310' ELSE '1300' END END,
     abs(net_value),counted.currency,
     'Stock count '||counted.count_number,'جرد مخزون '||counted.count_number,payload);
  END IF;

  UPDATE operations_stock_counts SET status='closed',closed_at=clock_timestamp(),
    closed_by=c.actor_id::uuid,journal_entry_id=journal,version=version+1
   WHERE id=counted.id RETURNING * INTO counted;
  answer := jsonb_build_object('action','close_count','countId',counted.id,'status',counted.status,
    'version',counted.version,'adjustedLines',adjusted,'netVarianceMinor',net_value,
    'currency',counted.currency,'journalId',journal);

 ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown stock count action';
 END CASE;

 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_stock_counts',counted.id::text,c.actor_id,
   c.session_id,c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,
   'allowed',c.reason,NULL,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_stock_count_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_stock_count_command(jsonb) TO orvex_runtime;
