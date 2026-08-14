import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createConfiguredNetworkWorker } from './production/composition.js';

export interface NetworkWorkerRunner {
  processNext(): Promise<unknown>;
}

export interface NetworkWorkerServiceOptions {
  readonly runner: NetworkWorkerRunner;
  readonly port: number;
  readonly pollIntervalMs: number;
  readonly mode: 'simulator' | 'configured';
  readonly now?: () => Date;
  readonly onError?: (safeMessage: string) => void;
}

export interface RunningNetworkWorkerService {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Configuration value must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function readNetworkWorkerEnvironment(environment: NodeJS.ProcessEnv): {
  readonly port: number;
  readonly pollIntervalMs: number;
  readonly mode: 'simulator' | 'configured';
} {
  const mode = environment.NETWORK_WORKER_MODE ?? 'simulator';
  if (mode !== 'simulator' && mode !== 'configured') {
    throw new Error('NETWORK_WORKER_MODE must be simulator or configured.');
  }
  return {
    port: parseInteger(environment.NETWORK_WORKER_PORT, 8092, 1, 65_535),
    pollIntervalMs: parseInteger(environment.NETWORK_WORKER_POLL_INTERVAL_MS, 250, 25, 60_000),
    mode,
  };
}

export async function startNetworkWorkerService(
  options: NetworkWorkerServiceOptions,
): Promise<RunningNetworkWorkerService> {
  const now = options.now ?? (() => new Date());
  let stopping = false;
  let polling = false;
  let lastPollAt: string | undefined;
  let lastSafeError: string | undefined =
    options.mode === 'configured'
      ? 'Network worker has not completed a configured database poll.'
      : undefined;

  const poll = async (): Promise<void> => {
    if (stopping || polling) return;
    polling = true;
    try {
      await options.runner.processNext();
      lastPollAt = now().toISOString();
      lastSafeError = undefined;
    } catch {
      lastSafeError = 'Network worker polling failed; inspect protected telemetry.';
      options.onError?.(lastSafeError);
    } finally {
      polling = false;
    }
  };
  await poll();
  const timer = setInterval(() => void poll(), options.pollIntervalMs);
  timer.unref();

  const server = createServer((request, response) => {
    if (request.method !== 'GET' || (request.url !== '/health' && request.url !== '/ready')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const ready = lastSafeError === undefined;
    response.writeHead(ready ? 200 : 503, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(
      JSON.stringify({
        service: 'Orvex ISP Network Worker',
        status: ready ? 'ready' : 'degraded',
        mode: options.mode,
        lastPollAt,
        ...(lastSafeError === undefined ? {} : { error: lastSafeError }),
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    server,
    port,
    close: async () => {
      stopping = true;
      clearInterval(timer);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  };
}

async function main(): Promise<void> {
  const configuration = readNetworkWorkerEnvironment(process.env);
  const configured =
    configuration.mode === 'configured' ? createConfiguredNetworkWorker(process.env) : undefined;
  const service = await startNetworkWorkerService({
    ...configuration,
    runner: configured?.runner ?? { processNext: () => Promise.resolve(undefined) },
    onError: (safeMessage) => process.stderr.write(`${safeMessage}\n`),
  });
  process.stdout.write(
    JSON.stringify({
      service: 'Orvex ISP Network Worker',
      port: service.port,
      mode: configuration.mode,
    }) + '\n',
  );
  const stop = (): void => {
    void service
      .close()
      .then(() => configured?.close())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const safeMessage = error instanceof Error ? error.message : 'Network worker failed to start.';
    process.stderr.write(`${safeMessage}\n`);
    process.exitCode = 1;
  });
}
