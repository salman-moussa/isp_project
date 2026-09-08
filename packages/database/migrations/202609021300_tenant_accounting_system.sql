-- 202609021300_tenant_accounting_system.sql
-- Complete Double-Entry Accounting System: COA, Journal Entries, Ledger, Accounting Periods

CREATE TABLE IF NOT EXISTS operations_chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_code text NOT NULL,
  account_name_en text NOT NULL,
  account_name_ar text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  currency text NOT NULL DEFAULT 'ANY' CHECK (currency IN ('USD', 'LBP', 'ANY')),
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_account_code UNIQUE (tenant_id, account_code)
);

CREATE TABLE IF NOT EXISTS operations_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number text NOT NULL,
  entry_date date NOT NULL,
  description_en text NOT NULL,
  description_ar text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('invoice', 'payment', 'credit_note', 'deposit', 'expense', 'manual', 'close')),
  source_id uuid,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  posted_by uuid NOT NULL REFERENCES users(id),
  CONSTRAINT uq_tenant_entry_number UNIQUE (tenant_id, entry_number)
);

CREATE TABLE IF NOT EXISTS operations_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES operations_journal_entries(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES operations_chart_of_accounts(id),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  memo_en text,
  memo_ar text,
  CONSTRAINT chk_journal_line_amount CHECK (debit_minor > 0 OR credit_minor > 0)
);

CREATE TABLE IF NOT EXISTS operations_accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'soft_closed', 'hard_closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_period_name UNIQUE (tenant_id, period_name)
);

-- FORCE ROW LEVEL SECURITY
ALTER TABLE operations_chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_chart_of_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_journal_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_journal_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_accounting_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_coa ON operations_chart_of_accounts
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_journal_entries ON operations_journal_entries
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_journal_lines ON operations_journal_lines
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_accounting_periods ON operations_accounting_periods
  USING (tenant_id = (operations_current_context()).tenant_id);

-- Default Chart of Accounts Seeding Function
CREATE OR REPLACE FUNCTION seed_tenant_default_chart_of_accounts(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO operations_chart_of_accounts (tenant_id, account_code, account_name_en, account_name_ar, account_type, currency, is_system)
  VALUES
    (p_tenant_id, '1010', 'Cashbox USD', 'صندوق المتجر USD', 'asset', 'USD', true),
    (p_tenant_id, '1020', 'Cashbox LBP', 'صندوق المتجر LBP', 'asset', 'LBP', true),
    (p_tenant_id, '1030', 'Bank USD', 'حساب البنك USD', 'asset', 'USD', true),
    (p_tenant_id, '1040', 'Bank LBP', 'حساب البنك LBP', 'asset', 'LBP', true),
    (p_tenant_id, '1100', 'Accounts Receivable USD', 'ذمم المشتركين USD', 'asset', 'USD', true),
    (p_tenant_id, '1110', 'Accounts Receivable LBP', 'ذمم المشتركين LBP', 'asset', 'LBP', true),
    (p_tenant_id, '2100', 'Accounts Payable USD', 'ذمم الموردين USD', 'liability', 'USD', true),
    (p_tenant_id, '2110', 'Accounts Payable LBP', 'ذمم الموردين LBP', 'liability', 'LBP', true),
    (p_tenant_id, '2200', 'VAT Payable', 'الضريبة على القيمة المضافة', 'liability', 'ANY', true),
    (p_tenant_id, '2220', 'Stamp Duty Payable', 'رسم الطابع المالي المستحق', 'liability', 'ANY', true),
    (p_tenant_id, '4000', 'Internet Service Revenue USD', 'إيرادات خدمات الإنترنت USD', 'revenue', 'USD', true),
    (p_tenant_id, '4010', 'Internet Service Revenue LBP', 'إيرادات خدمات الإنترنت LBP', 'revenue', 'LBP', true),
    (p_tenant_id, '4100', 'Add-on & Top-up Revenue', 'إيرادات الاشتراكات الإضافية', 'revenue', 'ANY', true),
    (p_tenant_id, '5000', 'Network Operating Expense', 'مصاريف تشغيل الشبكة', 'expense', 'ANY', true),
    (p_tenant_id, '5100', 'General & Admin Expense', 'المصاريف الإدارية والعمومية', 'expense', 'ANY', true)
  ON CONFLICT (tenant_id, account_code) DO NOTHING;
END;
$$;
