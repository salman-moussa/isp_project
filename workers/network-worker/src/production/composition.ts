import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import type { SecretReference } from '../domain.js';
import { createProductionNetworkWorker } from './factory.js';
import type { ParameterizedSqlClient } from './postgres-store.js';
import type { RouterOsBasicCredential, SecretReferenceResolver } from './routeros-rest.js';

export interface ConfiguredNetworkWorker {
  readonly runner: ReturnType<typeof createProductionNetworkWorker>;
  close(): Promise<void>;
}

export function createConfiguredNetworkWorker(
  environment: NodeJS.ProcessEnv,
): ConfiguredNetworkWorker {
  const databaseUrl = required(environment.NETWORK_DATABASE_URL, 'NETWORK_DATABASE_URL');
  const workerId = required(environment.NETWORK_WORKER_ID, 'NETWORK_WORKER_ID');
  const allowedRouterOrigins = required(
    environment.NETWORK_ROUTER_ALLOWED_ORIGINS,
    'NETWORK_ROUTER_ALLOWED_ORIGINS',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedRouterOrigins.length === 0) {
    throw new Error('NETWORK_ROUTER_ALLOWED_ORIGINS must contain at least one HTTPS origin.');
  }
  const secretFiles = parseSecretFiles(
    required(environment.NETWORK_SECRET_FILES_JSON, 'NETWORK_SECRET_FILES_JSON'),
  );
  const client = postgres(databaseUrl, {
    max: integer(environment.NETWORK_DATABASE_POOL_SIZE, 4, 1, 16),
    connect_timeout: 10,
    idle_timeout: 30,
    prepare: true,
  });
  const sql: ParameterizedSqlClient = {
    query: async <Row>(text: string, parameters: readonly unknown[]) => ({
      rows: (await client.unsafe(text, parameters as never[])) as unknown as readonly Row[],
    }),
  };
  return {
    runner: createProductionNetworkWorker({
      sql,
      workerId,
      allowedRouterOrigins,
      secrets: new FileSecretReferenceResolver(secretFiles),
      timeoutMs: integer(environment.NETWORK_ROUTER_TIMEOUT_MS, 10_000, 500, 60_000),
      leaseDurationMs: integer(environment.NETWORK_LEASE_DURATION_MS, 30_000, 1_000, 300_000),
      concurrencyPerRouter: integer(environment.NETWORK_CONCURRENCY_PER_ROUTER, 1, 1, 8),
    }),
    close: () => client.end({ timeout: 5 }),
  };
}

class FileSecretReferenceResolver implements SecretReferenceResolver {
  public constructor(private readonly files: ReadonlyMap<SecretReference, string>) {}

  public async resolveRouterOsBasic(reference: SecretReference): Promise<RouterOsBasicCredential> {
    const value = await this.read(reference);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('Router credential secret has an invalid format.');
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).username !== 'string' ||
      typeof (parsed as Record<string, unknown>).password !== 'string'
    ) {
      throw new Error('Router credential secret has an invalid format.');
    }
    const credential = parsed as { username: string; password: string };
    if (credential.username.length < 1 || credential.password.length < 1) {
      throw new Error('Router credential secret has an invalid format.');
    }
    return credential;
  }

  public async resolveSubscriberPassword(reference: SecretReference): Promise<string> {
    const value = (await this.read(reference)).trimEnd();
    if (value.length < 1 || value.length > 1_024) {
      throw new Error('Subscriber credential secret has an invalid format.');
    }
    return value;
  }

  private async read(reference: SecretReference): Promise<string> {
    const path = this.files.get(reference);
    if (!path) throw new Error('Secret reference is not configured for this worker.');
    if (!path.startsWith('/run/secrets/')) {
      throw new Error('Network worker secrets must be mounted below /run/secrets.');
    }
    return readFile(path, { encoding: 'utf8' });
  }
}

function parseSecretFiles(value: string): ReadonlyMap<SecretReference, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('NETWORK_SECRET_FILES_JSON must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('NETWORK_SECRET_FILES_JSON must be an object.');
  }
  const result = new Map<SecretReference, string>();
  for (const [reference, path] of Object.entries(parsed)) {
    if (!reference.startsWith('secret://') || typeof path !== 'string') {
      throw new Error('NETWORK_SECRET_FILES_JSON contains an invalid mapping.');
    }
    result.set(reference as SecretReference, path);
  }
  return result;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required in configured mode.`);
  return value;
}

function integer(
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
