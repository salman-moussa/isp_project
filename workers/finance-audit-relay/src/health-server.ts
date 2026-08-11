import { createServer, type Server } from 'node:http';
import type { RelayHealth } from './health.js';

export interface HealthServerOptions {
  readonly host: string;
  readonly port: number;
}

export async function startHealthServer(
  health: RelayHealth,
  options: HealthServerOptions,
): Promise<Server> {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    if (request.url === '/live') {
      response.writeHead(200);
      response.end(JSON.stringify({ service: 'finance-audit-relay', status: 'live' }));
      return;
    }
    if (request.url === '/ready') {
      const snapshot = health.snapshot();
      response.writeHead(snapshot.ready ? 200 : 503);
      response.end(JSON.stringify(snapshot));
      return;
    }
    if (request.url === '/health') {
      response.writeHead(200);
      response.end(JSON.stringify(health.snapshot()));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export async function stopHealthServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
