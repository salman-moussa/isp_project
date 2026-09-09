import { z } from 'zod';

/**
 * Network resources: router registry and service bindings for the RouterOS worker, durable job
 * control, IPAM pools with an allocation ledger, NAS clients and the CPE registry. Commands carry
 * secret *references* (pointers into the worker's secret files), never secret values.
 */
const uuid = z.string().uuid();
const secretReference = z
  .string()
  .trim()
  .regex(
    /^secret:\/\/[A-Za-z0-9/_-]{3,255}$/,
    'Use a secret:// reference, never the secret itself.',
  );
const routerId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,128}$/);
const ipv4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;
const ipAddress = z
  .string()
  .trim()
  .refine(
    (value) => ipv4.test(value) || /^[0-9A-Fa-f:]{3,39}$/u.test(value),
    'Invalid IP address.',
  );
const cidr = z
  .string()
  .trim()
  .refine(
    (value) =>
      /^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12]\d|3[0-2])$/u.test(value) ||
      /^[0-9A-Fa-f:]{3,39}\/(?:[0-9]|[1-9]\d|1[01]\d|12[0-8])$/u.test(value),
    'Use CIDR notation, for example 10.20.0.0/22.',
  );
const evidence = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
  evidence: z.string().trim().min(8).max(2000),
};

export const networkConnectorSchema = z.enum(['routeros-api', 'routeros-rest', 'simulator']);
export const ipPoolPurposeSchema = z.enum([
  'pppoe_dynamic',
  'static_public',
  'cgnat',
  'management',
  'infrastructure',
]);
export const networkJobStateSchema = z.enum([
  'queued',
  'running',
  'retry_scheduled',
  'reconciling',
  'reconciled',
  'succeeded',
  'partially_succeeded',
  'failed',
  'dead_lettered',
  'canceled',
]);
export type NetworkJobState = z.infer<typeof networkJobStateSchema>;

const routerFields = {
  routerId,
  endpoint: z
    .string()
    .trim()
    .url()
    .refine((value) => value.startsWith('https://'), 'Router endpoints must use HTTPS.'),
  routerAccessReference: secretReference,
  connector: networkConnectorSchema,
  enabled: z.boolean().default(true),
};

/** Router and NAS changes: `tenant.network.bulk.approve` plus a fresh MFA code. */
export const networkInfrastructureCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register_router'), ...routerFields, ...evidence }).strict(),
  z.object({ action: z.literal('update_router'), ...routerFields, ...evidence }).strict(),
  z
    .object({
      action: z.literal('upsert_nas_client'),
      nasClientId: uuid.optional(),
      expectedVersion: z.number().int().positive().optional(),
      nasName: z.string().trim().min(2).max(100),
      ipAddress,
      nasKeyReference: secretReference,
      nasType: z.enum(['mikrotik', 'cisco', 'huawei', 'other']).default('mikrotik'),
      description: z.string().trim().max(500).optional(),
      active: z.boolean().default(true),
      ...evidence,
    })
    .strict()
    .refine(
      (value) => (value.nasClientId === undefined) === (value.expectedVersion === undefined),
      {
        message: 'Updating a NAS client needs its id and expected version.',
        path: ['expectedVersion'],
      },
    ),
]);
export type NetworkInfrastructureCommand = z.infer<typeof networkInfrastructureCommandSchema>;

const poolFields = {
  poolName: z.string().trim().min(2).max(100),
  subnetCidr: cidr,
  gateway: ipAddress.optional(),
  vlanId: z.number().int().min(1).max(4094).optional(),
  purpose: ipPoolPurposeSchema.default('pppoe_dynamic'),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().default(true),
};

/** Pools, addresses, bindings, CPE and job control: `tenant.network.job.create`. */
export const networkResourceCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_ip_pool'), ...poolFields, ...evidence }).strict(),
  z
    .object({
      action: z.literal('update_ip_pool'),
      poolId: uuid,
      expectedVersion: z.number().int().positive(),
      ...poolFields,
      ...evidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('reserve_address'),
      poolId: uuid,
      address: ipAddress.optional(),
      kind: z.enum(['reserved', 'gateway', 'infrastructure']).default('reserved'),
      label: z.string().trim().min(1).max(120).optional(),
      ...evidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('allocate_service_address'),
      poolId: uuid,
      serviceId: uuid,
      address: ipAddress.optional(),
      label: z.string().trim().min(1).max(120).optional(),
      ...evidence,
    })
    .strict(),
  z.object({ action: z.literal('release_address'), allocationId: uuid, ...evidence }).strict(),
  z
    .object({
      action: z.literal('bind_service'),
      serviceId: uuid,
      routerId,
      accountName: z.string().trim().min(1).max(200),
      pppAccessReference: secretReference,
      poolId: z.string().trim().min(1).max(128).optional(),
      staticAddress: ipAddress.optional(),
      vlanId: z.string().trim().min(1).max(128).optional(),
      enabled: z.boolean().default(true),
      ...evidence,
    })
    .strict()
    .refine((value) => (value.poolId === undefined) !== (value.staticAddress === undefined), {
      message: 'Choose either a dynamic pool or a static address.',
      path: ['staticAddress'],
    }),
  z
    .object({
      action: z.literal('register_cpe'),
      serialNumber: z.string().trim().min(2).max(100),
      model: z.string().trim().max(120).optional(),
      oui: z.string().trim().max(12).optional(),
      tr069DeviceId: z.string().trim().max(200).optional(),
      serviceId: uuid.optional(),
      assetId: uuid.optional(),
      notes: z.string().trim().max(1000).optional(),
      ...evidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('update_cpe'),
      cpeId: uuid,
      expectedVersion: z.number().int().positive(),
      model: z.string().trim().max(120).optional(),
      oui: z.string().trim().max(12).optional(),
      tr069DeviceId: z.string().trim().max(200).optional(),
      serviceId: uuid.optional(),
      assetId: uuid.optional(),
      notes: z.string().trim().max(1000).optional(),
      ...evidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel_job'),
      jobId: z.string().trim().min(8).max(200),
      ...evidence,
    })
    .strict(),
  z
    .object({
      action: z.literal('retry_job'),
      jobId: z.string().trim().min(8).max(200),
      ...evidence,
    })
    .strict(),
]);
export type NetworkResourceCommand = z.infer<typeof networkResourceCommandSchema>;

export const networkWorkspaceQuerySchema = z
  .object({
    jobs: z.enum(['open', 'attention', 'closed', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type NetworkWorkspaceQuery = z.infer<typeof networkWorkspaceQuerySchema>;

export interface NetworkRouterRecord {
  readonly routerId: string;
  readonly endpoint: string;
  readonly credentialReference: string;
  readonly connector: z.infer<typeof networkConnectorSchema>;
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly boundServices: number;
  readonly openJobs: number;
}

export interface NetworkBindingRecord {
  readonly serviceId: string;
  readonly serviceNumber: string;
  readonly serviceStatus: string;
  readonly subscriberName: string;
  readonly routerId: string;
  readonly accountName: string;
  readonly passwordSecretReference: string;
  readonly poolId?: string | null;
  readonly staticAddress?: string | null;
  readonly vlanId?: string | null;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

export interface NetworkJobRecord {
  readonly jobId: string;
  readonly state: NetworkJobState;
  readonly kind?: string | null;
  readonly origin?: string | null;
  readonly routerId?: string | null;
  readonly serviceId?: string | null;
  readonly serviceNumber?: string | null;
  readonly subscriberName?: string | null;
  readonly actorId?: string | null;
  readonly reason?: string | null;
  readonly attempts: number;
  readonly previousAttempts: number;
  readonly lastErrorClass?: string | null;
  readonly lastOutcome?: unknown;
  readonly createdAt: string;
  readonly availableAt: string;
  readonly leaseOwner?: string | null;
}

export interface IpPoolSummary {
  readonly id: string;
  readonly poolName: string;
  readonly subnetCidr: string;
  readonly ipVersion: 'v4' | 'v6';
  readonly gateway?: string | null;
  readonly vlanId?: number | null;
  readonly purpose: z.infer<typeof ipPoolPurposeSchema>;
  readonly description?: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly usable?: number | null;
  readonly allocated: number;
}

export interface IpAllocationRecord {
  readonly id: string;
  readonly poolId: string;
  readonly address: string;
  readonly kind: 'service' | 'reserved' | 'gateway' | 'infrastructure';
  readonly serviceId?: string | null;
  readonly serviceNumber?: string | null;
  readonly label?: string | null;
  readonly status: 'allocated' | 'released';
  readonly allocatedAt: string;
  readonly releasedAt?: string | null;
}

export interface NasClientSummary {
  readonly id: string;
  readonly nasName: string;
  readonly ipAddress: string;
  readonly secretReference: string;
  readonly nasType: 'mikrotik' | 'cisco' | 'huawei' | 'other';
  readonly description?: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly activeSessions: number;
}

export interface CpeDeviceSummary {
  readonly id: string;
  readonly serialNumber: string;
  readonly model?: string | null;
  readonly oui?: string | null;
  readonly tr069DeviceId?: string | null;
  readonly firmwareVersion?: string | null;
  readonly lastInformAt?: string | null;
  readonly status: 'online' | 'offline';
  readonly serviceId?: string | null;
  readonly serviceNumber?: string | null;
  readonly assetId?: string | null;
  readonly notes?: string | null;
  readonly version: number;
}

export interface RadiusSessionSummary {
  readonly id: string;
  readonly acctSessionId: string;
  readonly username: string;
  readonly serviceNumber?: string | null;
  readonly framedIpAddress?: string | null;
  readonly nasIpAddress?: string | null;
  readonly startedAt: string;
  readonly stoppedAt?: string | null;
  readonly inputOctets: number;
  readonly outputOctets: number;
  readonly terminateCause?: string | null;
}

export interface NetworkEventRecord {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly actorId: string;
  readonly reasonEn: string;
  readonly reasonAr: string;
  readonly occurredAt: string;
}

export interface NetworkServiceOption {
  readonly id: string;
  readonly serviceNumber: string;
  readonly subscriberName: string;
  readonly status: string;
}

export interface NetworkWorkspace {
  readonly routers: readonly NetworkRouterRecord[];
  readonly bindings: readonly NetworkBindingRecord[];
  readonly jobs: readonly NetworkJobRecord[];
  readonly pools: readonly IpPoolSummary[];
  readonly allocations: readonly IpAllocationRecord[];
  readonly nasClients: readonly NasClientSummary[];
  readonly cpeDevices: readonly CpeDeviceSummary[];
  readonly sessions: readonly RadiusSessionSummary[];
  readonly events: readonly NetworkEventRecord[];
  readonly services: readonly NetworkServiceOption[];
}
