import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readNetworkWorkerEnvironment, startNetworkWorkerService } from './server.js';

function get(port: number, path: string): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('Network Worker service entrypoint', () => {
  it('validates bounded environment values', () => {
    expect(readNetworkWorkerEnvironment({ NETWORK_WORKER_PORT: '8092' })).toEqual({
      port: 8092,
      pollIntervalMs: 250,
      mode: 'simulator',
    });
    expect(() => readNetworkWorkerEnvironment({ NETWORK_WORKER_PORT: '0' })).toThrow(/integer/);
    expect(() => readNetworkWorkerEnvironment({ NETWORK_WORKER_MODE: 'live' })).toThrow(
      /simulator or configured/,
    );
  });

  it('runs a health endpoint and closes cleanly', async () => {
    const service = await startNetworkWorkerService({
      runner: { processNext: () => Promise.resolve(undefined) },
      port: 0,
      pollIntervalMs: 25,
      mode: 'simulator',
    });
    try {
      const response = await get(service.port, '/health');
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        service: 'Orvex ISP Network Worker',
        status: 'ready',
      });
    } finally {
      await service.close();
    }
  });
});
