import {
  networkWorkspaceQuerySchema,
  type CpeDeviceSummary,
  type IpAllocationRecord,
  type IpPoolSummary,
  type NasClientSummary,
  type NetworkBindingRecord,
  type NetworkEventRecord,
  type NetworkInfrastructureCommand,
  type NetworkJobRecord,
  type NetworkResourceCommand,
  type NetworkRouterRecord,
  type NetworkServiceOption,
  type NetworkWorkspace,
  type NetworkWorkspaceQuery,
  type RadiusSessionSummary,
  type VerifiedTenantId,
} from '@isp/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { inOperationsTransaction, OperationsAuthorizationError } from './context.js';
import type { SignedOperationsDatabaseContext } from './types.js';

export interface NetworkCommandResult extends Record<string, unknown> {
  readonly replayed: boolean;
}

export async function executeNetworkCommand(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly command: NetworkInfrastructureCommand | NetworkResourceCommand;
    readonly authorization: SignedOperationsDatabaseContext;
  },
): Promise<NetworkCommandResult> {
  return inOperationsTransaction(database, tenantId, input.authorization, async (transaction) => {
    const [row] = await transaction.execute<{
      readonly [key: string]: unknown;
      readonly result: NetworkCommandResult;
    }>(sql`SELECT execute_network_command(${JSON.stringify(input.command)}::jsonb) AS result`);
    if (!row) throw new Error('Network command returned no result.');
    return row.result;
  });
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const optional = (value: Date | string | null): string | null => (value ? iso(value) : null);

export async function readNetworkWorkspace(
  database: Database,
  tenantId: VerifiedTenantId,
  input: {
    readonly authorization: SignedOperationsDatabaseContext;
    readonly query?: Partial<NetworkWorkspaceQuery>;
  },
): Promise<NetworkWorkspace> {
  const query = networkWorkspaceQuerySchema.parse(input.query ?? {});
  return inOperationsTransaction(database, tenantId, input.authorization, async (tx) => {
    const [authority] = await tx.execute<{
      readonly [key: string]: unknown;
      readonly valid: boolean;
    }>(
      sql`SELECT true AS valid FROM operations_current_context()
          WHERE tenant_id=${tenantId} AND action='tenant.network.workspace.read' AND support_grant_id IS NULL
            AND permission IN ('tenant.network.view','tenant.network.job.create','tenant.network.bulk.approve')`,
    );
    if (!authority) throw new OperationsAuthorizationError('Network view authority required.');
    const [aggregates] = await tx.execute<{
      readonly [key: string]: unknown;
      readonly routers: readonly (Omit<NetworkRouterRecord, 'updatedAt'> & { updatedAt: string })[];
      readonly bindings: readonly NetworkBindingRecord[];
      readonly jobs: readonly NetworkJobRecord[];
    }>(sql`SELECT read_network_routers() AS routers, read_network_bindings() AS bindings,
              read_network_jobs(${query.jobs}, ${query.limit}) AS jobs`);
    const pools = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly pool_name: string;
      readonly subnet_cidr: string;
      readonly ip_version: 'v4' | 'v6';
      readonly gateway: string | null;
      readonly vlan_id: number | null;
      readonly purpose: IpPoolSummary['purpose'];
      readonly description: string | null;
      readonly active: boolean;
      readonly version: number;
      readonly utilization: { usable: number | null; allocated: number };
    }>(sql`SELECT p.id, p.pool_name, p.subnet_cidr, p.ip_version, host(p.gateway) AS gateway, p.vlan_id, p.purpose,
              p.description, p.active, p.version, network_pool_utilization(p.tenant_id, p.id) AS utilization
            FROM operations_ip_pools p WHERE p.tenant_id=${tenantId} ORDER BY p.active DESC, p.pool_name`);
    const allocations = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly pool_id: string;
      readonly address: string;
      readonly kind: IpAllocationRecord['kind'];
      readonly service_id: string | null;
      readonly service_number: string | null;
      readonly label: string | null;
      readonly status: IpAllocationRecord['status'];
      readonly allocated_at: Date | string;
      readonly released_at: Date | string | null;
    }>(sql`SELECT a.id, a.pool_id, host(a.address) AS address, a.kind, a.service_id, s.service_number, a.label,
              a.status, a.allocated_at, a.released_at
            FROM operations_ip_allocations a
            LEFT JOIN operations_services s ON s.tenant_id=a.tenant_id AND s.id=a.service_id
            WHERE a.tenant_id=${tenantId}
            ORDER BY a.status, a.address LIMIT 500`);
    const nasClients = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly nas_name: string;
      readonly ip_address: string;
      readonly secret_reference: string;
      readonly nas_type: NasClientSummary['nasType'];
      readonly description: string | null;
      readonly active: boolean;
      readonly version: number;
      readonly active_sessions: number | string;
    }>(sql`SELECT n.id, n.nas_name, host(n.ip_address) AS ip_address, n.secret_reference, n.nas_type, n.description,
              n.active, n.version,
              (SELECT count(*) FROM operations_radius_sessions r WHERE r.tenant_id=n.tenant_id AND r.nas_id=n.id AND r.stopped_at IS NULL) AS active_sessions
            FROM operations_nas_clients n WHERE n.tenant_id=${tenantId} ORDER BY n.nas_name`);
    const cpeDevices = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly serial_number: string;
      readonly model: string | null;
      readonly oui: string | null;
      readonly tr069_device_id: string | null;
      readonly firmware_version: string | null;
      readonly last_inform_at: Date | string | null;
      readonly status: 'online' | 'offline';
      readonly service_id: string | null;
      readonly service_number: string | null;
      readonly asset_id: string | null;
      readonly notes: string | null;
      readonly version: number;
    }>(sql`SELECT d.id, d.serial_number, d.model, d.oui, d.tr069_device_id, d.firmware_version, d.last_inform_at,
              d.status, d.service_id, s.service_number, d.asset_id, d.notes, d.version
            FROM operations_cpe_devices d
            LEFT JOIN operations_services s ON s.tenant_id=d.tenant_id AND s.id=d.service_id
            WHERE d.tenant_id=${tenantId} ORDER BY d.serial_number LIMIT 500`);
    const sessions = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly acct_session_id: string;
      readonly username: string;
      readonly service_number: string | null;
      readonly framed_ip_address: string | null;
      readonly nas_ip_address: string | null;
      readonly started_at: Date | string;
      readonly stopped_at: Date | string | null;
      readonly input_octets: string;
      readonly output_octets: string;
      readonly terminate_cause: string | null;
    }>(sql`SELECT r.id, r.acct_session_id, r.username, s.service_number, host(r.framed_ip_address) AS framed_ip_address,
              host(r.nas_ip_address) AS nas_ip_address, r.started_at, r.stopped_at, r.input_octets::text AS input_octets,
              r.output_octets::text AS output_octets, r.terminate_cause
            FROM operations_radius_sessions r
            LEFT JOIN operations_services s ON s.tenant_id=r.tenant_id AND s.id=r.service_id
            WHERE r.tenant_id=${tenantId}
            ORDER BY (r.stopped_at IS NULL) DESC, r.started_at DESC LIMIT 200`);
    const events = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly action: string;
      readonly resource_type: string;
      readonly resource_id: string;
      readonly actor_id: string;
      readonly reason_en: string;
      readonly reason_ar: string;
      readonly occurred_at: Date | string;
    }>(sql`SELECT id, action, resource_type, resource_id, actor_id, reason_en, reason_ar, occurred_at
            FROM operations_network_events WHERE tenant_id=${tenantId} ORDER BY occurred_at DESC LIMIT 100`);
    const services = await tx.execute<{
      readonly [key: string]: unknown;
      readonly id: string;
      readonly service_number: string;
      readonly subscriber_name: string;
      readonly status: string;
    }>(sql`SELECT s.id, s.service_number, u.display_name AS subscriber_name, s.status::text AS status
            FROM operations_services s JOIN operations_subscribers u ON u.tenant_id=s.tenant_id AND u.id=s.subscriber_id
            WHERE s.tenant_id=${tenantId} AND s.status <> 'terminated' ORDER BY s.service_number LIMIT 500`);

    return {
      routers: (aggregates?.routers ?? []).map((router) => ({
        ...router,
        updatedAt: iso(router.updatedAt),
      })),
      bindings: (aggregates?.bindings ?? []).map((binding) => ({
        ...binding,
        updatedAt: iso(binding.updatedAt),
      })),
      jobs: (aggregates?.jobs ?? []).map((job) => ({
        ...job,
        createdAt: iso(job.createdAt),
        availableAt: iso(job.availableAt),
      })),
      pools: pools.map(
        (row): IpPoolSummary => ({
          id: row.id,
          poolName: row.pool_name,
          subnetCidr: row.subnet_cidr,
          ipVersion: row.ip_version,
          gateway: row.gateway,
          vlanId: row.vlan_id,
          purpose: row.purpose,
          description: row.description,
          active: row.active,
          version: Number(row.version),
          usable: row.utilization?.usable ?? null,
          allocated: Number(row.utilization?.allocated ?? 0),
        }),
      ),
      allocations: allocations.map(
        (row): IpAllocationRecord => ({
          id: row.id,
          poolId: row.pool_id,
          address: row.address,
          kind: row.kind,
          serviceId: row.service_id,
          serviceNumber: row.service_number,
          label: row.label,
          status: row.status,
          allocatedAt: iso(row.allocated_at),
          releasedAt: optional(row.released_at),
        }),
      ),
      nasClients: nasClients.map(
        (row): NasClientSummary => ({
          id: row.id,
          nasName: row.nas_name,
          ipAddress: row.ip_address,
          secretReference: row.secret_reference,
          nasType: row.nas_type,
          description: row.description,
          active: row.active,
          version: Number(row.version),
          activeSessions: Number(row.active_sessions),
        }),
      ),
      cpeDevices: cpeDevices.map(
        (row): CpeDeviceSummary => ({
          id: row.id,
          serialNumber: row.serial_number,
          model: row.model,
          oui: row.oui,
          tr069DeviceId: row.tr069_device_id,
          firmwareVersion: row.firmware_version,
          lastInformAt: optional(row.last_inform_at),
          status: row.status,
          serviceId: row.service_id,
          serviceNumber: row.service_number,
          assetId: row.asset_id,
          notes: row.notes,
          version: Number(row.version),
        }),
      ),
      sessions: sessions.map(
        (row): RadiusSessionSummary => ({
          id: row.id,
          acctSessionId: row.acct_session_id,
          username: row.username,
          serviceNumber: row.service_number,
          framedIpAddress: row.framed_ip_address,
          nasIpAddress: row.nas_ip_address,
          startedAt: iso(row.started_at),
          stoppedAt: optional(row.stopped_at),
          inputOctets: Number(row.input_octets),
          outputOctets: Number(row.output_octets),
          terminateCause: row.terminate_cause,
        }),
      ),
      events: events.map(
        (row): NetworkEventRecord => ({
          id: row.id,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          actorId: row.actor_id,
          reasonEn: row.reason_en,
          reasonAr: row.reason_ar,
          occurredAt: iso(row.occurred_at),
        }),
      ),
      services: services.map(
        (row): NetworkServiceOption => ({
          id: row.id,
          serviceNumber: row.service_number,
          subscriberName: row.subscriber_name,
          status: row.status,
        }),
      ),
    };
  });
}
