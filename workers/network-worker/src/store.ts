import type {
  NetworkJob,
  NetworkJobRequest,
  NetworkJobState,
  RouterRegistration,
} from './domain.js';

export interface DurableNetworkStore {
  enqueue(request: NetworkJobRequest, now: Date): Promise<NetworkJob>;
  claimNext(now: Date): Promise<NetworkJob | undefined>;
  save(job: NetworkJob): Promise<void>;
  get(jobId: string): Promise<NetworkJob | undefined>;
  getByIdempotency(tenantId: string, idempotencyKey: string): Promise<NetworkJob | undefined>;
  listDeadLetters(): Promise<readonly NetworkJob[]>;
  registerRouter(router: RouterRegistration): Promise<void>;
  getRouter(tenantId: string, routerId: string): Promise<RouterRegistration | undefined>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneRouter(router: RouterRegistration): RouterRegistration {
  return { ...router, endpoint: new URL(router.endpoint.toString()) };
}

export class InMemoryDurableNetworkStore implements DurableNetworkStore {
  readonly #jobs = new Map<string, NetworkJob>();
  readonly #idempotency = new Map<string, string>();
  readonly #routers = new Map<string, RouterRegistration>();
  #sequence = 0;

  async enqueue(request: NetworkJobRequest, now: Date): Promise<NetworkJob> {
    const key = `${request.tenantId}:${request.idempotencyKey}`;
    const existingId = this.#idempotency.get(key);
    if (existingId !== undefined) return clone(this.#jobs.get(existingId)!);
    const job: NetworkJob = {
      jobId: `network-job-${++this.#sequence}`,
      request: clone(request),
      createdAt: now.toISOString(),
      attempts: [],
      state: 'queued',
      availableAt: now.toISOString(),
    };
    this.#jobs.set(job.jobId, job);
    this.#idempotency.set(key, job.jobId);
    return clone(job);
  }

  async claimNext(now: Date): Promise<NetworkJob | undefined> {
    const readyStates = new Set<NetworkJobState>(['queued', 'retry_scheduled', 'reconciling']);
    const next = [...this.#jobs.values()]
      .filter((job) => readyStates.has(job.state) && Date.parse(job.availableAt) <= now.getTime())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (next === undefined) return undefined;
    const claimed = { ...next, state: 'running' as const };
    this.#jobs.set(claimed.jobId, claimed);
    return clone(claimed);
  }

  async save(job: NetworkJob): Promise<void> {
    if (!this.#jobs.has(job.jobId)) throw new Error('Unknown network job.');
    this.#jobs.set(job.jobId, clone(job));
  }

  async get(jobId: string): Promise<NetworkJob | undefined> {
    const job = this.#jobs.get(jobId);
    return job === undefined ? undefined : clone(job);
  }

  async getByIdempotency(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<NetworkJob | undefined> {
    const jobId = this.#idempotency.get(`${tenantId}:${idempotencyKey}`);
    return jobId === undefined ? undefined : this.get(jobId);
  }

  async listDeadLetters(): Promise<readonly NetworkJob[]> {
    return [...this.#jobs.values()].filter((job) => job.state === 'dead_lettered').map(clone);
  }

  async registerRouter(router: RouterRegistration): Promise<void> {
    this.#routers.set(`${router.tenantId}:${router.routerId}`, cloneRouter(router));
  }

  async getRouter(tenantId: string, routerId: string): Promise<RouterRegistration | undefined> {
    const router = this.#routers.get(`${tenantId}:${routerId}`);
    return router === undefined ? undefined : cloneRouter(router);
  }
}
