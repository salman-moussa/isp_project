-- 202609021400_tenant_dealers_and_vouchers.sql
-- Dealer, Reseller, Commission, and Voucher Lifecycle

CREATE TABLE IF NOT EXISTS operations_dealers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dealer_code text NOT NULL,
  dealer_name text NOT NULL,
  contact_phone text NOT NULL,
  credit_limit_minor_usd bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor_usd >= 0),
  credit_limit_minor_lbp bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor_lbp >= 0),
  commission_rate_bps integer NOT NULL DEFAULT 500 CHECK (commission_rate_bps BETWEEN 0 AND 5000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_dealer_code UNIQUE (tenant_id, dealer_code)
);

CREATE TABLE IF NOT EXISTS operations_voucher_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  dealer_id uuid REFERENCES operations_dealers(id),
  face_value_minor bigint NOT NULL CHECK (face_value_minor > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 10000),
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_batch_number UNIQUE (tenant_id, batch_number)
);

CREATE TABLE IF NOT EXISTS operations_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES operations_voucher_batches(id) ON DELETE CASCADE,
  serial_number text NOT NULL,
  pin_hash text NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'issued', 'redeemed', 'cancelled')),
  redeemed_by_subscriber_id uuid REFERENCES operations_subscribers(id),
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_voucher_serial UNIQUE (tenant_id, serial_number)
);

-- FORCE ROW LEVEL SECURITY
ALTER TABLE operations_dealers ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_dealers FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_voucher_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_voucher_batches FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_vouchers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_dealers ON operations_dealers
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_voucher_batches ON operations_voucher_batches
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_vouchers ON operations_vouchers
  USING (tenant_id = (operations_current_context()).tenant_id);
