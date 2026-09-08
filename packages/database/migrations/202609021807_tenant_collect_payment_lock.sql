-- REQ-COL-002 / REQ-SEC-003: lock payable evidence without granting runtime UPDATE
-- on immutable assignments or exposing the private finance guard table.
CREATE FUNCTION collect_lock_payable_assignment(target_assignment uuid)
RETURNS TABLE(invoice_id uuid,currency text,outstanding_minor text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM operations_current_context();
  IF c.tenant_id IS NULL OR c.support_grant_id IS NOT NULL
    OR c.permission<>'tenant.payment.post' OR c.action<>'tenant.collection.evidence.record' THEN
    RAISE EXCEPTION USING ERRCODE='P4033',MESSAGE='signed collector payment authority required';
  END IF;
  PERFORM accounting_lock_financial_request();
  RETURN QUERY
    SELECT a.finance_invoice_id,a.currency::text,
      (i.amount_minor-g.allocated_minor-g.credited_minor)::text
    FROM operations_collector_assignments a
    JOIN finance_invoices i ON i.tenant_id=a.tenant_id AND i.id=a.finance_invoice_id
      AND i.entry_kind='posted'
    JOIN finance_document_guards g ON g.tenant_id=i.tenant_id
      AND g.document_type='invoice' AND g.document_id=i.id AND g.reversed_at IS NULL
    WHERE a.tenant_id=c.tenant_id AND a.id=target_assignment
      AND a.collector_user_id::text=c.actor_id
      AND operations_scope_allows_route(a.tenant_id,a.route_id,a.id)
      AND a.status IN ('assigned','visited','returned')
      AND NOT EXISTS(SELECT 1 FROM operations_collector_collection_evidence e
        WHERE e.tenant_id=a.tenant_id AND e.assignment_id=a.id)
    FOR UPDATE OF a,g;
END;
$$;
REVOKE ALL ON FUNCTION collect_lock_payable_assignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collect_lock_payable_assignment(uuid) TO orvex_runtime;
