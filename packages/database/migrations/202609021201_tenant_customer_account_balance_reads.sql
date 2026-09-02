-- REQ-SEC-003: expose balances through signed, scoped reads, never raw guard-table grants.
CREATE FUNCTION operations_finance_balances()
RETURNS TABLE(tenant_id uuid,document_type text,document_id uuid,allocated_minor bigint,
  reversed_at timestamptz,credited_net_minor bigint,credited_vat_minor bigint,
  credited_stamp_minor bigint,credited_minor bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT g.tenant_id,g.document_type,g.document_id,g.allocated_minor,g.reversed_at,
    g.credited_net_minor,g.credited_vat_minor,g.credited_stamp_minor,g.credited_minor
  FROM finance_document_guards g
  JOIN operations_current_context() ctx ON ctx.tenant_id=g.tenant_id
  WHERE ctx.support_grant_id IS NULL AND (
    (g.document_type='invoice' AND customer_account_invoice_scope(g.tenant_id,g.document_id))
    OR
    (g.document_type='payment' AND EXISTS(
      SELECT 1 FROM operations_customer_account_entries e
      WHERE e.tenant_id=g.tenant_id AND e.payment_id=g.document_id
        AND e.kind='deposit_received'
        AND operations_scope_allows_subscriber(e.tenant_id,e.subscriber_id)))
  )
$$;
REVOKE ALL ON FUNCTION operations_finance_balances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations_finance_balances() TO orvex_runtime;

