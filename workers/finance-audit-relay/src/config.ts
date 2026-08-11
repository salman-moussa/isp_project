import type { VerifiedTenantId } from '@isp/contracts';

export interface RelayTenantConfig {
  readonly tenantId: VerifiedTenantId;
  readonly databaseUrl: string;
}

export interface RelayConfig {
  readonly controlDatabaseUrl: string;
  readonly tenants: readonly RelayTenantConfig[];
  readonly healthHost: string;
  readonly healthPort: number;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaximumMs: number;
  readonly backoffJitterRatio: number;
  readonly readinessMaximumBacklogCount: number;
  readonly readinessMaximumBacklogAgeMs: number;
  readonly readinessMaximumStaleMs: number;
}

const tenantIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readRelayConfig(environment: NodeJS.ProcessEnv): RelayConfig {
  const controlDatabaseUrl = requireDatabaseUrl(
    environment.FINANCE_AUDIT_CONTROL_DATABASE_URL,
    'FINANCE_AUDIT_CONTROL_DATABASE_URL',
  );
  const tenants = parseTenants(environment.FINANCE_AUDIT_TENANTS_JSON);
  const pollIntervalMs = readInteger(
    environment,
    'FINANCE_AUDIT_POLL_INTERVAL_MS',
    1_000,
    50,
    300_000,
  );
  const readinessMaximumStaleMs = readInteger(
    environment,
    'FINANCE_AUDIT_READINESS_MAX_STALE_MS',
    60_000,
    pollIntervalMs * 2,
    86_400_000,
  );
  const backoffBaseMs = readInteger(environment, 'FINANCE_AUDIT_BACKOFF_BASE_MS', 250, 10, 60_000);
  const backoffMaximumMs = readInteger(
    environment,
    'FINANCE_AUDIT_BACKOFF_MAXIMUM_MS',
    30_000,
    backoffBaseMs,
    3_600_000,
  );

  return {
    controlDatabaseUrl,
    tenants,
    healthHost: environment.FINANCE_AUDIT_HEALTH_HOST?.trim() || '0.0.0.0',
    healthPort: readInteger(environment, 'FINANCE_AUDIT_HEALTH_PORT', 9_464, 1, 65_535),
    batchSize: readInteger(environment, 'FINANCE_AUDIT_BATCH_SIZE', 100, 1, 500),
    pollIntervalMs,
    backoffBaseMs,
    backoffMaximumMs,
    backoffJitterRatio: readNumber(environment, 'FINANCE_AUDIT_BACKOFF_JITTER_RATIO', 0.2, 0, 1),
    readinessMaximumBacklogCount: readInteger(
      environment,
      'FINANCE_AUDIT_READINESS_MAX_BACKLOG_COUNT',
      500,
      0,
      10_000_000,
    ),
    readinessMaximumBacklogAgeMs: readInteger(
      environment,
      'FINANCE_AUDIT_READINESS_MAX_BACKLOG_AGE_MS',
      120_000,
      1_000,
      86_400_000,
    ),
    readinessMaximumStaleMs,
  };
}

function parseTenants(value: string | undefined): readonly RelayTenantConfig[] {
  if (!value?.trim()) {
    throw new Error('FINANCE_AUDIT_TENANTS_JSON is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('FINANCE_AUDIT_TENANTS_JSON must be valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('FINANCE_AUDIT_TENANTS_JSON must be a non-empty array.');
  }

  const tenantIds = new Set<string>();
  return parsed.map((entry: unknown, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Finance audit tenant entry ${index} must be an object.`);
    }
    const tenantId = entry.tenantId;
    if (typeof tenantId !== 'string' || !tenantIdPattern.test(tenantId)) {
      throw new Error(`Finance audit tenant entry ${index} has an invalid tenantId.`);
    }
    if (tenantIds.has(tenantId)) {
      throw new Error(`Finance audit tenant entry ${index} duplicates a tenantId.`);
    }
    tenantIds.add(tenantId);
    return {
      tenantId: tenantId as VerifiedTenantId,
      databaseUrl: requireDatabaseUrl(
        typeof entry.databaseUrl === 'string' ? entry.databaseUrl : undefined,
        `finance audit tenant entry ${index} databaseUrl`,
      ),
    };
  });
}

function requireDatabaseUrl(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }
  return value;
}

function readInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[name] === undefined ? defaultValue : Number(environment[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function readNumber(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[name] === undefined ? defaultValue : Number(environment[name]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
