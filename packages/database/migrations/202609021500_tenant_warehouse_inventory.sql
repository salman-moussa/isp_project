-- 202609021500_tenant_warehouse_inventory.sql
-- Warehouse, Purchase Orders, SKUs, and Serialized CPE/Asset Custody

CREATE TABLE IF NOT EXISTS operations_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_code text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  location_address text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_warehouse_code UNIQUE (tenant_id, warehouse_code)
);

CREATE TABLE IF NOT EXISTS operations_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  category text NOT NULL CHECK (category IN ('router_cpe', 'ont_onu', 'fiber_cable', 'drop_wire', 'connector', 'accessory', 'other')),
  unit_cost_minor_usd bigint NOT NULL DEFAULT 0 CHECK (unit_cost_minor_usd >= 0),
  unit_cost_minor_lbp bigint NOT NULL DEFAULT 0 CHECK (unit_cost_minor_lbp >= 0),
  serialized_flag boolean NOT NULL DEFAULT true,
  reorder_threshold integer NOT NULL DEFAULT 5 CHECK (reorder_threshold >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_item_sku UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS operations_serialized_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES operations_inventory_items(id),
  serial_number text NOT NULL,
  mac_address text,
  warehouse_id uuid REFERENCES operations_warehouses(id),
  current_custodian_id uuid REFERENCES users(id),
  installed_service_id uuid REFERENCES operations_services(id),
  status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'reserved', 'issued', 'installed', 'returned', 'rma')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_asset_serial UNIQUE (tenant_id, serial_number)
);

CREATE TABLE IF NOT EXISTS operations_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  supplier_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'received', 'cancelled')),
  total_amount_minor bigint NOT NULL DEFAULT 0 CHECK (total_amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'LBP')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES users(id),
  received_at timestamptz,
  CONSTRAINT uq_tenant_po_number UNIQUE (tenant_id, po_number)
);

-- FORCE ROW LEVEL SECURITY
ALTER TABLE operations_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_warehouses FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_inventory_items FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_serialized_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_serialized_assets FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_purchase_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_warehouses ON operations_warehouses
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_inventory_items ON operations_inventory_items
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_serialized_assets ON operations_serialized_assets
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_purchase_orders ON operations_purchase_orders
  USING (tenant_id = (operations_current_context()).tenant_id);
