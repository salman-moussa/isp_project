import {
  type NasClientRecord,
  type RadiusSessionRecord,
  type IpPoolRecord,
  type CpeDeviceRecord,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export async function readNasClients(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly NasClientRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      nas_name: string;
      ip_address: string;
      secret_reference: string;
      nas_type: NasClientRecord['nasType'];
      active: boolean;
    }>(sql`
      SELECT id, nas_name, ip_address::text, secret_reference, nas_type, active
      FROM operations_nas_clients
      WHERE tenant_id = ${tenantId}
      ORDER BY nas_name ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      nasName: r.nas_name,
      ipAddress: r.ip_address,
      secretReference: r.secret_reference,
      nasType: r.nas_type,
      active: r.active,
    }));
  });
}

export async function readRadiusSessions(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly RadiusSessionRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      acct_session_id: string;
      username: string;
      framed_ip_address: string | null;
      calling_station_id: string | null;
      started_at: Date | string;
      stopped_at: Date | string | null;
      input_octets: string;
      output_octets: string;
      terminate_cause: string | null;
    }>(sql`
      SELECT id, acct_session_id, username, framed_ip_address::text, calling_station_id,
             started_at, stopped_at, input_octets::text, output_octets::text, terminate_cause
      FROM operations_radius_sessions
      WHERE tenant_id = ${tenantId}
      ORDER BY started_at DESC
      LIMIT 200
    `);

    return rows.map((r) => ({
      id: r.id,
      acctSessionId: r.acct_session_id,
      username: r.username,
      framedIpAddress: r.framed_ip_address,
      callingStationId: r.calling_station_id,
      startedAt: typeof r.started_at === 'string' ? r.started_at : r.started_at.toISOString(),
      stoppedAt: r.stopped_at
        ? typeof r.stopped_at === 'string'
          ? r.stopped_at
          : r.stopped_at.toISOString()
        : null,
      inputOctets: parseInt(r.input_octets, 10),
      outputOctets: parseInt(r.output_octets, 10),
      terminateCause: r.terminate_cause,
    }));
  });
}

export async function readIpPools(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly IpPoolRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      pool_name: string;
      subnet_cidr: string;
      ip_version: IpPoolRecord['ipVersion'];
      gateway: string | null;
      vlan_id: number | null;
      active: boolean;
    }>(sql`
      SELECT id, pool_name, subnet_cidr, ip_version, gateway::text, vlan_id, active
      FROM operations_ip_pools
      WHERE tenant_id = ${tenantId}
      ORDER BY pool_name ASC
    `);

    return rows.map((r) => ({
      id: r.id,
      poolName: r.pool_name,
      subnetCidr: r.subnet_cidr,
      ipVersion: r.ip_version,
      gateway: r.gateway,
      vlanId: r.vlan_id,
      active: r.active,
    }));
  });
}

export async function readCpeDevices(
  database: Database,
  tenantId: VerifiedTenantId,
  authorization: SignedOperationsDatabaseContext,
): Promise<readonly CpeDeviceRecord[]> {
  return inOperationsTransaction(database, tenantId, authorization, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      serial_number: string;
      oui: string | null;
      tr069_device_id: string | null;
      firmware_version: string | null;
      connection_request_url: string | null;
      last_inform_at: Date | string | null;
      status: CpeDeviceRecord['status'];
    }>(sql`
      SELECT id, serial_number, oui, tr069_device_id, firmware_version, connection_request_url, last_inform_at, status
      FROM operations_cpe_devices
      WHERE tenant_id = ${tenantId}
      ORDER BY serial_number ASC
      LIMIT 200
    `);

    return rows.map((r) => ({
      id: r.id,
      serialNumber: r.serial_number,
      oui: r.oui,
      tr069DeviceId: r.tr069_device_id,
      firmwareVersion: r.firmware_version,
      connectionRequestUrl: r.connection_request_url,
      lastInformAt: r.last_inform_at
        ? typeof r.last_inform_at === 'string'
          ? r.last_inform_at
          : r.last_inform_at.toISOString()
        : null,
      status: r.status,
    }));
  });
}

export async function disconnectRadiusSession(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly sessionId: string;
    readonly reason: string;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<{ readonly id: string; readonly status: string }> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    await transaction.execute(sql`
      UPDATE operations_radius_sessions
      SET stopped_at = clock_timestamp(), terminate_cause = ${input.reason}
      WHERE tenant_id = ${tenantId} AND id = ${input.sessionId}
    `);

    return { id: input.sessionId, status: 'disconnected' };
  });
}
