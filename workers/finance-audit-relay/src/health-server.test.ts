import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { VerifiedTenantId } from '@isp/contracts';
import { RelayHealth } from './health.js';
import { startHealthServer, stopHealthServer } from './health-server.js';

const tenantId = '00000000-0000-4000-8000-000000000001' as VerifiedTenantId;
const servers: Awaited<ReturnType<typeof startHealthServer>>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(stopHealthServer));
});

describe('finance audit relay health server', () => {
  it('keeps liveness open while readiness reflects dependencies, backlog, and last success', async () => {
    const now = new Date('2026-08-11T12:00:00.000Z');
    const health = new RelayHealth([tenantId], 60_000, 500, 120_000, now);
    const server = await startHealthServer(health, { host: '127.0.0.1', port: 0 });
    servers.push(server);
    const port = (server.address() as AddressInfo).port;

    expect((await fetch(`http://127.0.0.1:${port}/live`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);

    health.recordControlSuccess(new Date());
    health.recordDiscoverySuccess(new Date());
    health.recordTenantAttempt(tenantId, new Date());
    health.recordTenantSuccess(tenantId, new Date(), 3, 7, new Date().toISOString());
    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await response.json()) as {
      ready: boolean;
      deliveredTotal: number;
      lastSuccessAt: string;
      tenants: {
        backlog: {
          observedAt: string;
          pendingCount: number;
          oldestOccurredAt: string;
          healthy: boolean;
        };
      }[];
    };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ready: true, deliveredTotal: 3 });
    expect(body.lastSuccessAt).toBeTruthy();
    const backlog = body.tenants[0]?.backlog;
    expect(typeof backlog?.observedAt).toBe('string');
    expect(typeof backlog?.oldestOccurredAt).toBe('string');
    expect(backlog).toMatchObject({
      pendingCount: 7,
      healthy: true,
    });

    health.recordTenantFailure(tenantId, new Date());
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);
  });

  it('fails readiness when a successful drain still leaves an old backlog', async () => {
    const now = new Date();
    const health = new RelayHealth([tenantId], 60_000, 500, 120_000, now);
    health.recordControlSuccess(now);
    health.recordDiscoverySuccess(now);
    health.recordTenantAttempt(tenantId, now);
    health.recordTenantSuccess(
      tenantId,
      now,
      100,
      1,
      new Date(now.getTime() - 120_001).toISOString(),
    );
    const server = await startHealthServer(health, { host: '127.0.0.1', port: 0 });
    servers.push(server);
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${port}/ready`);
    const body = (await response.json()) as { tenants: { backlog: { healthy: boolean } }[] };
    expect(response.status).toBe(503);
    expect(body.tenants[0]?.backlog.healthy).toBe(false);
  });
});
