-- REQ-WHS-008: vendor quote requests, comparison, and damaged quantities on receipt.
--
-- Purchase orders could be created, but only by someone who already knew the price. There was no
-- way to ask several vendors, compare what came back, and turn the chosen quote into an order
-- without retyping it. This migration adds that path, and records goods rejected on arrival
-- without ever letting them into stock.

CREATE TABLE operations_vendor_quote_requests(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_number text NOT NULL CHECK(length(btrim(request_number)) BETWEEN 2 AND 80),
  warehouse_id uuid NOT NULL,
  needed_by date,
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','awarded','cancelled')),
  awarded_quote_id uuid,
  purchase_order_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  FOREIGN KEY(tenant_id,warehouse_id) REFERENCES operations_warehouses(tenant_id,id),
  FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES operations_purchase_orders(tenant_id,id),
  UNIQUE(tenant_id,request_number),
  UNIQUE(tenant_id,id)
);

CREATE TABLE operations_vendor_quote_request_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  line_number integer NOT NULL CHECK(line_number>0),
  item_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0 AND quantity<=10000),
  FOREIGN KEY(tenant_id,request_id) REFERENCES operations_vendor_quote_requests(tenant_id,id),
  FOREIGN KEY(tenant_id,item_id) REFERENCES operations_inventory_items(tenant_id,id),
  UNIQUE(tenant_id,request_id,line_number),
  UNIQUE(tenant_id,id)
);

CREATE TABLE operations_vendor_quotes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  currency text NOT NULL CHECK(currency IN('USD','LBP')),
  -- Denormalized from the lines so comparison does not depend on re-summing every read.
  total_amount_minor bigint NOT NULL CHECK(total_amount_minor>=0),
  lead_time_days integer NOT NULL CHECK(lead_time_days>=0 AND lead_time_days<=365),
  valid_until date,
  status text NOT NULL DEFAULT 'received' CHECK(status IN('received','awarded','rejected')),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,request_id) REFERENCES operations_vendor_quote_requests(tenant_id,id),
  FOREIGN KEY(tenant_id,vendor_id) REFERENCES operations_procurement_vendors(tenant_id,id),
  -- One quote per vendor per request: a second submission is a correction, not a rival bid.
  UNIQUE(tenant_id,request_id,vendor_id),
  UNIQUE(tenant_id,id)
);

CREATE TABLE operations_vendor_quote_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  request_line_id uuid NOT NULL,
  unit_cost_minor bigint NOT NULL CHECK(unit_cost_minor>0 AND unit_cost_minor<=9007199254740991),
  FOREIGN KEY(tenant_id,quote_id) REFERENCES operations_vendor_quotes(tenant_id,id),
  FOREIGN KEY(tenant_id,request_line_id) REFERENCES operations_vendor_quote_request_lines(tenant_id,id),
  UNIQUE(tenant_id,quote_id,request_line_id),
  UNIQUE(tenant_id,id)
);

ALTER TABLE operations_vendor_quote_requests
  ADD CONSTRAINT quote_request_awarded_quote FOREIGN KEY(tenant_id,awarded_quote_id)
    REFERENCES operations_vendor_quotes(tenant_id,id);

-- Goods rejected on arrival are recorded but never enter stock; the line stays outstanding so the
-- vendor can re-ship, which is exactly what a backorder is.
CREATE TABLE operations_purchase_receipt_rejections(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_line_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0 AND quantity<=1000000),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 1000),
  actor_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text NOT NULL,
  sequence integer NOT NULL CHECK(sequence>0),
  FOREIGN KEY(tenant_id,purchase_order_line_id)
    REFERENCES operations_purchase_order_lines(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key,sequence)
);

ALTER TABLE operations_vendor_quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quote_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quote_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quote_request_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_vendor_quote_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE operations_purchase_receipt_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_purchase_receipt_rejections FORCE ROW LEVEL SECURITY;

-- A quote request names the warehouse it will be delivered to and the items being sourced, so the
-- quote session must be able to read both. Every new signed action has to be admitted here
-- explicitly; the scope functions are the single seam where that happens.
CREATE OR REPLACE FUNCTION inventory_warehouse_scope_allows(target_tenant uuid,target_branch uuid,target_record uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
   AND (c.permission IN('tenant.installation.view','tenant.installation.manage') OR
     (c.permission='tenant.catalog.manage' AND c.action IN(
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage',
       'tenant.warehouse.quote.manage')) OR
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
       'tenant.warehouse.procurement.manage','tenant.warehouse.administration.manage',
       'tenant.warehouse.quote.manage')) OR
     (c.permission='tenant.accounting.post' AND c.action IN(
       'tenant.warehouse.stock.adjust','tenant.warehouse.stock.count.close','tenant.warehouse.rma.scrap'))))
$$;

-- Quote requests and the purchase order they award live in the procurement plane.
CREATE OR REPLACE FUNCTION procurement_scope_allows(target_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
    AND (c.permission IN('tenant.installation.view','tenant.catalog.manage','tenant.accounting.post')
      OR (c.permission='tenant.installation.manage' AND c.action='tenant.warehouse.rma.manage')))
$$;

CREATE OR REPLACE FUNCTION procurement_order_scope_allows(target_tenant uuid,target_order uuid,target_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM operations_current_context() c
  WHERE c.tenant_id=target_tenant AND c.support_grant_id IS NULL
    AND c.permission IN('tenant.installation.view','tenant.catalog.manage','tenant.accounting.post')
    AND (c.branch_ids IS NULL OR (target_branch IS NOT NULL AND target_branch=ANY(c.branch_ids)))
    AND (c.record_ids IS NULL OR target_order=ANY(c.record_ids)))
$$;

CREATE POLICY quote_request_scope ON operations_vendor_quote_requests
  USING(procurement_scope_allows(tenant_id)) WITH CHECK(procurement_scope_allows(tenant_id));
CREATE POLICY quote_request_line_scope ON operations_vendor_quote_request_lines
  USING(EXISTS(SELECT 1 FROM operations_vendor_quote_requests r
    WHERE r.tenant_id=operations_vendor_quote_request_lines.tenant_id
      AND r.id=operations_vendor_quote_request_lines.request_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_vendor_quote_requests r
    WHERE r.tenant_id=operations_vendor_quote_request_lines.tenant_id
      AND r.id=operations_vendor_quote_request_lines.request_id));
CREATE POLICY vendor_quote_scope ON operations_vendor_quotes
  USING(procurement_scope_allows(tenant_id)) WITH CHECK(procurement_scope_allows(tenant_id));
CREATE POLICY vendor_quote_line_scope ON operations_vendor_quote_lines
  USING(EXISTS(SELECT 1 FROM operations_vendor_quotes q
    WHERE q.tenant_id=operations_vendor_quote_lines.tenant_id
      AND q.id=operations_vendor_quote_lines.quote_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_vendor_quotes q
    WHERE q.tenant_id=operations_vendor_quote_lines.tenant_id
      AND q.id=operations_vendor_quote_lines.quote_id));
CREATE POLICY receipt_rejection_scope ON operations_purchase_receipt_rejections
  USING(EXISTS(SELECT 1 FROM operations_purchase_order_lines l
    WHERE l.tenant_id=operations_purchase_receipt_rejections.tenant_id
      AND l.id=operations_purchase_receipt_rejections.purchase_order_line_id))
  WITH CHECK(EXISTS(SELECT 1 FROM operations_purchase_order_lines l
    WHERE l.tenant_id=operations_purchase_receipt_rejections.tenant_id
      AND l.id=operations_purchase_receipt_rejections.purchase_order_line_id));

REVOKE ALL ON operations_vendor_quote_requests,operations_vendor_quote_request_lines,
  operations_vendor_quotes,operations_vendor_quote_lines,operations_purchase_receipt_rejections
  FROM PUBLIC,orvex_runtime;
GRANT SELECT ON operations_vendor_quote_requests,operations_vendor_quote_request_lines,
  operations_vendor_quotes,operations_vendor_quote_lines,operations_purchase_receipt_rejections
  TO orvex_runtime;

CREATE TRIGGER receipt_rejection_immutable
 BEFORE UPDATE OR DELETE ON operations_purchase_receipt_rejections
 FOR EACH ROW EXECUTE FUNCTION operations_reject_append_only_mutation();

ALTER TABLE operations_procurement_events DROP CONSTRAINT operations_procurement_events_action_check;
ALTER TABLE operations_procurement_events ADD CONSTRAINT operations_procurement_events_action_check
  CHECK(action IN('create_vendor','create_purchase_order','approve_purchase_order',
    'receive_purchase_order','create_quote_request','record_quote','award_quote','cancel_quote_request'));
ALTER TABLE operations_procurement_events DROP CONSTRAINT operations_procurement_events_aggregate_type_check;
ALTER TABLE operations_procurement_events ADD CONSTRAINT operations_procurement_events_aggregate_type_check
  CHECK(aggregate_type IN('vendor','purchase_order','quote_request'));

-- The event policy enumerates aggregate types, so the new one has to be admitted here too or a
-- quote event is written into a row the writer cannot satisfy.
DROP POLICY procurement_event_scope ON operations_procurement_events;
CREATE POLICY procurement_event_scope ON operations_procurement_events
  USING((aggregate_type='vendor' AND procurement_scope_allows(tenant_id))
    OR (aggregate_type='quote_request' AND EXISTS(SELECT 1 FROM operations_vendor_quote_requests r
      WHERE r.tenant_id=operations_procurement_events.tenant_id
        AND r.id=operations_procurement_events.aggregate_id))
    OR (aggregate_type='purchase_order' AND EXISTS(SELECT 1 FROM operations_purchase_orders p
      WHERE p.tenant_id=operations_procurement_events.tenant_id
        AND p.id=operations_procurement_events.aggregate_id)))
  WITH CHECK((aggregate_type='vendor' AND procurement_scope_allows(tenant_id))
    OR (aggregate_type='quote_request' AND EXISTS(SELECT 1 FROM operations_vendor_quote_requests r
      WHERE r.tenant_id=operations_procurement_events.tenant_id
        AND r.id=operations_procurement_events.aggregate_id))
    OR (aggregate_type='purchase_order' AND EXISTS(SELECT 1 FROM operations_purchase_orders p
      WHERE p.tenant_id=operations_procurement_events.tenant_id
        AND p.id=operations_procurement_events.aggregate_id)));

CREATE FUNCTION execute_vendor_quote_command(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c operations_request_contexts%ROWTYPE; prior operations_procurement_events%ROWTYPE;
 request operations_vendor_quote_requests%ROWTYPE; quote operations_vendor_quotes%ROWTYPE;
 vendor operations_procurement_vendors%ROWTYPE; wh operations_warehouses%ROWTYPE;
 po operations_purchase_orders%ROWTYPE; line record; answer jsonb; total bigint:=0;
 aggregate_version integer:=1;
BEGIN
 SELECT * INTO c FROM operations_current_context();
 IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
   OR c.permission<>'tenant.catalog.manage' OR c.action<>'tenant.warehouse.quote.manage' THEN
  RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed vendor quote authority required';
 END IF;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR length(btrim(coalesce(payload->>'reasonEn',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'reasonAr',''))) NOT BETWEEN 8 AND 1000
   OR length(btrim(coalesce(payload->>'evidence',''))) NOT BETWEEN 8 AND 2000 THEN
  RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='complete bilingual quote evidence is required';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':quote:'||c.idempotency_key,0));
 SELECT * INTO prior FROM operations_procurement_events
  WHERE tenant_id=c.tenant_id AND idempotency_key=c.idempotency_key;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload OR prior.actor_id::text<>c.actor_id THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='quote retry key belongs to different content';
  END IF;
  RETURN prior.result;
 END IF;

 CASE payload->>'action'
 WHEN 'create_quote_request' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','requestNumber','warehouseId','neededBy','lines','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown quote request field'; END IF;
  IF jsonb_typeof(payload->'lines') IS DISTINCT FROM 'array'
    OR jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a quote request requires 1 to 100 lines'; END IF;
  SELECT * INTO wh FROM operations_warehouses WHERE tenant_id=c.tenant_id
   AND id=(payload->>'warehouseId')::uuid AND active FOR SHARE;
  IF wh.id IS NULL
    OR (c.branch_ids IS NOT NULL AND (wh.branch_id IS NULL OR NOT wh.branch_id=ANY(c.branch_ids))) THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='receiving warehouse is unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'lines') l
    LEFT JOIN operations_inventory_items i ON i.tenant_id=c.tenant_id
      AND i.id=(l->>'itemId')::uuid AND i.active WHERE i.id IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='quote request lines require an active catalog item'; END IF;
  INSERT INTO operations_vendor_quote_requests(tenant_id,request_number,warehouse_id,needed_by,created_by)
  VALUES(c.tenant_id,btrim(payload->>'requestNumber'),wh.id,
    nullif(payload->>'neededBy','')::date,c.actor_id::uuid) RETURNING * INTO request;
  INSERT INTO operations_vendor_quote_request_lines(tenant_id,request_id,line_number,item_id,quantity)
   SELECT c.tenant_id,request.id,ordinality,(value->>'itemId')::uuid,(value->>'quantity')::integer
   FROM jsonb_array_elements(payload->'lines') WITH ORDINALITY;
  answer := jsonb_build_object('action','create_quote_request','requestId',request.id,
    'status',request.status,'version',request.version);

 WHEN 'record_quote' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','requestId','expectedVersion','vendorId','currency','leadTimeDays','validUntil',
     'lines','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown quote field'; END IF;
  SELECT * INTO request FROM operations_vendor_quote_requests
   WHERE tenant_id=c.tenant_id AND id=(payload->>'requestId')::uuid FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='quote request is outside the current scope'; END IF;
  IF request.status<>'open' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open request can receive quotes'; END IF;
  IF request.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='quote request changed; refresh before acting'; END IF;
  SELECT * INTO vendor FROM operations_procurement_vendors WHERE tenant_id=c.tenant_id
   AND id=(payload->>'vendorId')::uuid AND active FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='vendor is unavailable'; END IF;
  -- Every requested line must be priced, or the quotes are not comparable.
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)))
     <> (SELECT count(*) FROM operations_vendor_quote_request_lines
          WHERE tenant_id=c.tenant_id AND request_id=request.id) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a quote must price every requested line'; END IF;

  SELECT sum(l.quantity::bigint * (q.value->>'unitCostMinor')::bigint) INTO total
   FROM jsonb_array_elements(payload->'lines') AS q(value)
   JOIN operations_vendor_quote_request_lines l ON l.tenant_id=c.tenant_id
     AND l.request_id=request.id AND l.id=(q.value->>'requestLineId')::uuid;
  IF total IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='a quoted line does not belong to this request'; END IF;
  IF total>9007199254740991 THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='quote exceeds safe money range'; END IF;

  INSERT INTO operations_vendor_quotes(tenant_id,request_id,vendor_id,currency,total_amount_minor,
    lead_time_days,valid_until,recorded_by)
  VALUES(c.tenant_id,request.id,vendor.id,payload->>'currency',total,
    (payload->>'leadTimeDays')::integer,nullif(payload->>'validUntil','')::date,c.actor_id::uuid)
  RETURNING * INTO quote;
  INSERT INTO operations_vendor_quote_lines(tenant_id,quote_id,request_line_id,unit_cost_minor)
   SELECT c.tenant_id,quote.id,(value->>'requestLineId')::uuid,(value->>'unitCostMinor')::bigint
   FROM jsonb_array_elements(payload->'lines');
  UPDATE operations_vendor_quote_requests SET version=version+1
   WHERE id=request.id RETURNING * INTO request;
  aggregate_version := request.version;
  answer := jsonb_build_object('action','record_quote','requestId',request.id,'quoteId',quote.id,
    'status',request.status,'version',request.version,'totalAmountMinor',total,
    'currency',quote.currency);

 WHEN 'award_quote' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','requestId','expectedVersion','quoteId','poNumber','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown quote field'; END IF;
  SELECT * INTO request FROM operations_vendor_quote_requests
   WHERE tenant_id=c.tenant_id AND id=(payload->>'requestId')::uuid FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='quote request is outside the current scope'; END IF;
  IF request.status<>'open' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open request can be awarded'; END IF;
  IF request.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='quote request changed; refresh before awarding'; END IF;
  SELECT * INTO quote FROM operations_vendor_quotes
   WHERE tenant_id=c.tenant_id AND id=(payload->>'quoteId')::uuid AND request_id=request.id FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='quote does not belong to this request'; END IF;
  IF quote.valid_until IS NOT NULL
    AND quote.valid_until < (clock_timestamp() AT TIME ZONE 'UTC')::date THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='this quote has expired and cannot be awarded'; END IF;

  -- Awarding turns the chosen quote into a draft order at the quoted prices, so nobody retypes
  -- them and the order can still be reviewed and approved normally.
  SELECT * INTO vendor FROM operations_procurement_vendors
   WHERE tenant_id=c.tenant_id AND id=quote.vendor_id FOR SHARE;
  INSERT INTO operations_purchase_orders(tenant_id,po_number,supplier_name,vendor_id,warehouse_id,
    branch_id,status,total_amount_minor,currency)
  SELECT c.tenant_id,btrim(payload->>'poNumber'),vendor.name_en,vendor.id,request.warehouse_id,
    w.branch_id,'draft',quote.total_amount_minor,quote.currency
  FROM operations_warehouses w WHERE w.tenant_id=c.tenant_id AND w.id=request.warehouse_id
  RETURNING * INTO po;
  INSERT INTO operations_purchase_order_lines(tenant_id,purchase_order_id,line_number,item_id,
    quantity,unit_cost_minor)
   SELECT c.tenant_id,po.id,l.line_number,l.item_id,l.quantity,q.unit_cost_minor
   FROM operations_vendor_quote_request_lines l
   JOIN operations_vendor_quote_lines q ON q.tenant_id=l.tenant_id AND q.request_line_id=l.id
     AND q.quote_id=quote.id
   WHERE l.tenant_id=c.tenant_id AND l.request_id=request.id;

  UPDATE operations_vendor_quotes SET status='awarded' WHERE id=quote.id;
  UPDATE operations_vendor_quotes SET status='rejected'
   WHERE tenant_id=c.tenant_id AND request_id=request.id AND id<>quote.id AND status='received';
  UPDATE operations_vendor_quote_requests SET status='awarded',awarded_quote_id=quote.id,
    purchase_order_id=po.id,resolved_at=clock_timestamp(),version=version+1
   WHERE id=request.id RETURNING * INTO request;
  aggregate_version := request.version;
  answer := jsonb_build_object('action','award_quote','requestId',request.id,'quoteId',quote.id,
    'purchaseOrderId',po.id,'status',request.status,'version',request.version,
    'totalAmountMinor',po.total_amount_minor,'currency',po.currency);

 WHEN 'cancel_quote_request' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN
    ('action','requestId','expectedVersion','reasonEn','reasonAr','evidence')) THEN
   RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown quote field'; END IF;
  SELECT * INTO request FROM operations_vendor_quote_requests
   WHERE tenant_id=c.tenant_id AND id=(payload->>'requestId')::uuid FOR UPDATE;
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='quote request is outside the current scope'; END IF;
  IF request.status<>'open' THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='only an open request can be cancelled'; END IF;
  IF request.version<>(payload->>'expectedVersion')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P4091',MESSAGE='quote request changed; refresh before acting'; END IF;
  UPDATE operations_vendor_quote_requests SET status='cancelled',resolved_at=clock_timestamp(),
    version=version+1 WHERE id=request.id RETURNING * INTO request;
  aggregate_version := request.version;
  answer := jsonb_build_object('action','cancel_quote_request','requestId',request.id,
    'status',request.status,'version',request.version);

 ELSE RAISE EXCEPTION USING ERRCODE='P4001',MESSAGE='unknown vendor quote action';
 END CASE;

 INSERT INTO operations_procurement_events(tenant_id,aggregate_type,aggregate_id,aggregate_version,
   action,reason_en,reason_ar,evidence,actor_id,idempotency_key,request_payload,result)
 VALUES(c.tenant_id,'quote_request',request.id,aggregate_version,payload->>'action',
   payload->>'reasonEn',payload->>'reasonAr',payload->>'evidence',c.actor_id::uuid,
   c.idempotency_key,payload,answer);
 INSERT INTO operations_audit_outbox(tenant_id,action,resource_type,resource_id,actor_id,session_id,
   permission,request_id,idempotency_key,ip_address,user_agent,result,reason,before_value,after_value)
 VALUES(c.tenant_id,c.action,'operations_vendor_quote_requests',request.id::text,c.actor_id,
   c.session_id,c.permission,c.request_id,c.idempotency_key,c.ip_address,c.user_agent,
   'allowed',c.reason,NULL,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION execute_vendor_quote_command(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_vendor_quote_command(jsonb) TO orvex_runtime;
