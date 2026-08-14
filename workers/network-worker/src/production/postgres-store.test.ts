import { describe, expect, it } from 'vitest';
import type { NetworkJob, NetworkJobRequest } from '../domain.js';
import { PostgresDurableNetworkStore, type ParameterizedSqlClient } from './postgres-store.js';

const request: NetworkJobRequest = {
  requestId: 'request-1',
  idempotencyKey: "tenant-key'--",
  tenantId: "tenant-a' or true --",
  routerId: 'router-a',
  subscriberServiceId: 'service-a',
  action: {
    kind: 'pppoe.suspend',
    desired: {
      accountName: 'subscriber-a',
      enabled: false,
      profileId: 'restricted',
      ipAssignment: { mode: 'dynamic', poolId: 'pool-a' },
    },
  },
  origin: 'tenant-network-operation',
  actorId: 'operator-a',
  permission: 'network.manage',
  reason: 'Past due',
};

function job(state: NetworkJob['state'] = 'queued'): NetworkJob {
  return {
    jobId: 'network-job-a',
    request,
    createdAt: '2026-08-13T09:00:00.000Z',
    attempts: [],
    state,
    availableAt: '2026-08-13T09:00:00.000Z',
  };
}

describe('PostgresDurableNetworkStore', () => {
  it('uses bound parameters for untrusted idempotency and tenant values', async () => {
    const calls: { text: string; parameters: readonly unknown[] }[] = [];
    const sql: ParameterizedSqlClient = {
      query: async <Row>(text: string, parameters: readonly unknown[]) => {
        calls.push({ text, parameters });
        return { rows: [{ job: job() } as Row] };
      },
    };
    const store = new PostgresDurableNetworkStore(sql, 'worker-a');
    await store.getByIdempotency(request.tenantId, request.idempotencyKey);

    expect(calls[0]?.text).toContain('$1::text, $2::text');
    expect(calls[0]?.text).not.toContain(request.tenantId);
    expect(calls[0]?.text).not.toContain(request.idempotencyKey);
    expect(calls[0]?.parameters).toEqual([request.tenantId, request.idempotencyKey]);
  });

  it('claims with a bounded lease token and makes save conditional on that claim', async () => {
    const calls: { text: string; parameters: readonly unknown[] }[] = [];
    const sql: ParameterizedSqlClient = {
      query: async <Row>(text: string, parameters: readonly unknown[]) => {
        calls.push({ text, parameters });
        if (text.includes('claim_job')) {
          return {
            rows: [
              { job: job('running'), lease_token: '7c52f4e4-2102-4b55-a62a-2fe36964f460' } as Row,
            ],
          };
        }
        return { rows: [{ saved: true } as Row] };
      },
    };
    const store = new PostgresDurableNetworkStore(sql, 'worker-a', 12_000);
    const claimed = await store.claimNext(new Date('2026-08-13T09:00:00.000Z'));
    expect(claimed?.state).toBe('running');
    await store.save({ ...claimed!, state: 'retry_scheduled' });

    expect(calls[0]?.parameters).toEqual(['worker-a', '2026-08-13T09:00:00.000Z', 12_000]);
    expect(calls[1]?.text).toContain('save_job($1::text, $2::uuid, $3::jsonb)');
    expect(calls[1]?.parameters[1]).toBe('7c52f4e4-2102-4b55-a62a-2fe36964f460');
    expect(calls[1]?.parameters[2]).toEqual({ ...claimed!, state: 'retry_scheduled' });
    await expect(store.save(job('dead_lettered'))).rejects.toThrow('no active claim lease');
  });

  it('rejects a lost lease instead of overwriting another worker result', async () => {
    const sql: ParameterizedSqlClient = {
      query: async <Row>(text: string) => ({
        rows: text.includes('claim_job')
          ? ([
              { job: job('running'), lease_token: '7c52f4e4-2102-4b55-a62a-2fe36964f460' },
            ] as Row[])
          : ([{ saved: false }] as Row[]),
      }),
    };
    const store = new PostgresDurableNetworkStore(sql, 'worker-a');
    const claimed = await store.claimNext(new Date());
    await expect(store.save(claimed!)).rejects.toThrow('claim lease was lost');
  });
});
