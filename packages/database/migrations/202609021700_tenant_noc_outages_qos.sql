-- 202609021700_tenant_noc_outages_qos.sql
-- NOC Telemetry Alarms, Outage Management, Incidents, and TRA Regulatory QoS Evidence

CREATE TABLE IF NOT EXISTS operations_network_alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'major', 'minor', 'warning')),
  alarm_code text NOT NULL,
  message_en text NOT NULL,
  message_ar text NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'cleared')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS operations_outages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  outage_title_en text NOT NULL,
  outage_title_ar text NOT NULL,
  affected_region text NOT NULL,
  impacted_subscribers_count integer NOT NULL DEFAULT 0 CHECK (impacted_subscribers_count >= 0),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  root_cause_en text,
  root_cause_ar text,
  status text NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved'))
);

CREATE TABLE IF NOT EXISTS operations_qos_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_period text NOT NULL,
  uptime_percentage numeric(5, 2) NOT NULL CHECK (uptime_percentage BETWEEN 0 AND 100),
  avg_latency_ms integer NOT NULL CHECK (avg_latency_ms >= 0),
  billing_accuracy_pct numeric(5, 2) NOT NULL DEFAULT 100.00 CHECK (billing_accuracy_pct BETWEEN 0 AND 100),
  mttr_hours numeric(5, 2) NOT NULL CHECK (mttr_hours >= 0),
  submitted_to_tra boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_tenant_qos_period UNIQUE (tenant_id, report_period)
);

-- FORCE ROW LEVEL SECURITY
ALTER TABLE operations_network_alarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_network_alarms FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_outages ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_outages FORCE ROW LEVEL SECURITY;

ALTER TABLE operations_qos_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_qos_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_alarms ON operations_network_alarms
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_outages ON operations_outages
  USING (tenant_id = (operations_current_context()).tenant_id);

CREATE POLICY tenant_isolation_qos_reports ON operations_qos_reports
  USING (tenant_id = (operations_current_context()).tenant_id);
