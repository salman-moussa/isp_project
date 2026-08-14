import type { NetworkJob, NetworkJobRequest, RouterRegistration } from '../domain.js';
import type { DurableNetworkStore } from '../store.js';

export interface ParameterizedSqlResult<Row> {
  readonly rows: readonly Row[];
}

/** Minimal boundary which can be wrapped around postgres, pg, or a transaction client. */
export interface ParameterizedSqlClient {
  query<Row>(text: string, parameters: readonly unknown[]): Promise<ParameterizedSqlResult<Row>>;
}

interface JobRow {
  readonly job: unknown;
}

interface ClaimedJobRow extends JobRow {
  readonly lease_token: string;
}

interface RouterRow {
  readonly router_id: string;
  readonly tenant_id: string;
  readonly endpoint: string;
  readonly credential_reference: string;
  readonly connector: RouterRegistration['connector'];
  readonly enabled: boolean;
}

function parseJob(value: unknown): NetworkJob {
  if (typeof value !== 'object' || value === null)
    throw new Error('Network store returned malformed job data.');
  const candidate = value as Partial<NetworkJob>;
  if (
    typeof candidate.jobId !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.availableAt !== 'string' ||
    typeof candidate.request !== 'object' ||
    candidate.request === null ||
    !Array.isArray(candidate.attempts) ||
    typeof candidate.state !== 'string'
  ) {
    throw new Error('Network store returned malformed job data.');
  }
  return structuredClone(candidate as NetworkJob);
}

function parseRouter(row: RouterRow): RouterRegistration {
  if (!row.credential_reference.startsWith('secret://')) {
    throw new Error('Network store returned an invalid credential reference.');
  }
  return {
    routerId: row.router_id,
    tenantId: row.tenant_id,
    endpoint: new URL(row.endpoint),
    credentialReference: row.credential_reference as RouterRegistration['credentialReference'],
    connector: row.connector,
    enabled: row.enabled,
  };
}

/**
 * PostgreSQL implementation of the durable queue contract in network-store-contract.sql.
 * A claim lease is held only in memory long enough to make the following save conditional.
 */
export class PostgresDurableNetworkStore implements DurableNetworkStore {
  readonly #leaseTokens = new Map<string, string>();

  constructor(
    private readonly sql: ParameterizedSqlClient,
    private readonly workerId: string,
    private readonly leaseDurationMs = 30_000,
  ) {
    if (workerId.trim() === '') throw new Error('Network worker ID is required.');
    if (
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs < 1_000 ||
      leaseDurationMs > 300_000
    ) {
      throw new Error('Network lease duration must be between 1000 and 300000 milliseconds.');
    }
  }

  async enqueue(request: NetworkJobRequest, now: Date): Promise<NetworkJob> {
    const result = await this.sql.query<JobRow>(
      'select job from network_worker.enqueue_job($1::jsonb, $2::timestamptz)',
      [request, now.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Network enqueue returned no job.');
    return parseJob(row.job);
  }

  async claimNext(now: Date): Promise<NetworkJob | undefined> {
    const result = await this.sql.query<ClaimedJobRow>(
      'select job, lease_token from network_worker.claim_job($1::text, $2::timestamptz, $3::integer)',
      [this.workerId, now.toISOString(), this.leaseDurationMs],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const job = parseJob(row.job);
    this.#leaseTokens.set(job.jobId, row.lease_token);
    return job;
  }

  async save(job: NetworkJob): Promise<void> {
    const leaseToken = this.#leaseTokens.get(job.jobId);
    if (leaseToken === undefined) throw new Error('Network job has no active claim lease.');
    const result = await this.sql.query<{ readonly saved: boolean }>(
      'select network_worker.save_job($1::text, $2::uuid, $3::jsonb) as saved',
      [this.workerId, leaseToken, job],
    );
    if (result.rows[0]?.saved !== true) throw new Error('Network job claim lease was lost.');
    this.#leaseTokens.delete(job.jobId);
  }

  async get(jobId: string): Promise<NetworkJob | undefined> {
    const result = await this.sql.query<JobRow>(
      'select job from network_worker.get_job($1::text)',
      [jobId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseJob(row.job);
  }

  async getByIdempotency(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<NetworkJob | undefined> {
    const result = await this.sql.query<JobRow>(
      'select job from network_worker.get_job_by_idempotency($1::text, $2::text)',
      [tenantId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseJob(row.job);
  }

  async listDeadLetters(): Promise<readonly NetworkJob[]> {
    const result = await this.sql.query<JobRow>(
      'select job from network_worker.list_dead_letters($1::integer)',
      [1_000],
    );
    return result.rows.map((row) => parseJob(row.job));
  }

  async registerRouter(router: RouterRegistration): Promise<void> {
    await this.sql.query(
      'select network_worker.register_router($1::text, $2::text, $3::text, $4::text, $5::text, $6::boolean)',
      [
        router.tenantId,
        router.routerId,
        router.endpoint.toString(),
        router.credentialReference,
        router.connector,
        router.enabled,
      ],
    );
  }

  async getRouter(tenantId: string, routerId: string): Promise<RouterRegistration | undefined> {
    const result = await this.sql.query<RouterRow>(
      'select * from network_worker.get_router($1::text, $2::text)',
      [tenantId, routerId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : parseRouter(row);
  }
}
