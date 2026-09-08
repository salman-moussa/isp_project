-- 202609021600_tenant_radius_ipam_cpe.sql
-- RADIUS AAA Sessions, NAS Clients, IPAM Pools/VLANs, and CPE TR-069 Integration

CREATE TABLE IF NOT EXISTS operations_nas_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nas_name text NOT NULL,
  ip_address inet NOT NULL,
  secret_reference text NOT NULL,
  nas_type text NOT NULL DEFAULT 'mikrotik' CHECK (nas_type IN ('mikrotik', 'cisco', 'huawei', 'other')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_nas_ip UNIQUE (tenant_id, ip_address)
);

CREATE TABLE IF NOT EXISTS operations_radius_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nas_id uuid REFERENCES operations_nas_clients(id),
  subscriber_id uuid REFERENCES operations_subscribers(id),
  service_id uuid REFERENCES operations_services(id),
  acct_session_id text NOT NULL,
  username text NOT NULL,
  framed_ip_address inet,
  calling_station_id text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stopped_at timestamptz,
  input_octets bigint NOT NULL DEFAULT 0 CHECK (input_octets >= 0),
  output_octets bigint NOT NULL DEFAULT 0 CHECK (output_octets >= 0),
  terminate_cause text,
  CONSTRAINT uq_tenant_acct_session UNIQUE (tenant_id, acct_session_id)
);

CREATE TABLE IF NOT EXISTS operations_ip_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pool_name text NOT NULL,
  subnet_cidr text NOT NULL,
  ip_version text NOT NULL CHECK (ip_version IN ('v4', 'v6')),
  gateway inet,
  vlan_id integer CHECK (vlan_id BETWEEN 1 AND 4094),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_pool_name UNIQUE (tenant_id, pool_name)
);

CREATE TABLE IF NOT EXISTS operations_cpe_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  serial_number text NOT NULL,
  oui text,
  tr069_device_id text,
  firmware_version text,
  connection_request_url text,
  last_inform_at timestamptz,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_cpe_serial UNIQUE (tenant_id, serial_number)
);

-- FORCE ROW LEVEL SECURITY
ALTER TABLE operations_nas_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_nas_clients FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_radius_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_radius_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_ip_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_ip_pools FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_cpe_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_cpe_devices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_nas_clients ON operations_nas_clients
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_radius_sessions ON operations_radius_sessions
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_ip_pools ON operations_ip_pools
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_cpe_devices ON operations_cpe_devices
  USING (tenant_id = (operations_current_context()).tenant_id);
