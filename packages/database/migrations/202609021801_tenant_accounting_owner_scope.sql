-- Forced RLS applies to owner SECURITY DEFINER functions as well. Runtime never receives
-- this policy: the only write entrypoints enforce signed action, scope and permission.
CREATE POLICY accounting_coa_owner ON operations_chart_of_accounts TO orvex_owner
 USING (EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=operations_chart_of_accounts.tenant_id AND c.support_grant_id IS NULL));
CREATE POLICY accounting_journal_owner ON operations_journal_entries TO orvex_owner
 USING (EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=operations_journal_entries.tenant_id AND c.support_grant_id IS NULL));
CREATE POLICY accounting_lines_owner ON operations_journal_lines TO orvex_owner
 USING (EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=operations_journal_lines.tenant_id AND c.support_grant_id IS NULL));
CREATE POLICY accounting_period_owner ON operations_accounting_periods TO orvex_owner
 USING (EXISTS(SELECT 1 FROM operations_current_context() c WHERE c.tenant_id=operations_accounting_periods.tenant_id AND c.support_grant_id IS NULL));
