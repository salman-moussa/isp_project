import {
  createDatabase,
  drainFinanceAuditOutbox,
  drainControlSubscriptionStateOutbox,
  drainOperationsAuditOutbox,
  listFinanceAuditRelayTenants,
  listOperationsAuditRelayTenants,
  listPendingControlSubscriptionStateTenants,
  readControlSubscriptionStateBacklog,
  readFinanceAuditBacklog,
  readOperationsRelayBacklog,
} from '@isp/database';
import type { VerifiedTenantId } from '@isp/contracts';
import { readRelayConfig } from './config.js';
import { RelayHealth } from './health.js';
import { startHealthServer, stopHealthServer } from './health-server.js';
import { jsonLogger } from './logger.js';
import { probeControlRelayCapability, probeTenantRelayCapability } from './probes.js';
import { FinanceAuditRelay, type RelayTenantTarget } from './relay.js';

async function main(): Promise<void> {
  let config: ReturnType<typeof readRelayConfig>;
  try {
    config = readRelayConfig(process.env);
  } catch {
    jsonLogger.write('error', 'configuration_invalid');
    process.exitCode = 1;
    return;
  }

  const control = createDatabase(config.controlDatabaseUrl);
  const tenantPools = new Map<string, ReturnType<typeof createDatabase>>();
  const knownTenantsByDatabase = new Map<string, Set<VerifiedTenantId>>();
  for (const tenant of config.tenants) {
    let tenantPool = tenantPools.get(tenant.databaseUrl);
    if (!tenantPool) {
      tenantPool = createDatabase(tenant.databaseUrl);
      tenantPools.set(tenant.databaseUrl, tenantPool);
    }
    const knownTenants = knownTenantsByDatabase.get(tenant.databaseUrl) ?? new Set();
    knownTenants.add(tenant.tenantId);
    knownTenantsByDatabase.set(tenant.databaseUrl, knownTenants);
  }

  const createTarget = (
    tenantPool: ReturnType<typeof createDatabase>,
    tenantId: VerifiedTenantId,
  ): RelayTenantTarget => ({
    tenantId,
    probe: () => probeTenantRelayCapability(tenantPool.client),
    async drain(deliveredAt, batchSize) {
      const delivered = await drainFinanceAuditOutbox(
        tenantPool.db,
        control.db,
        tenantId,
        deliveredAt,
        batchSize,
      );
      const operationsDelivered = await drainOperationsAuditOutbox(
        tenantPool.db,
        control.db,
        tenantId,
        deliveredAt,
        batchSize,
      );
      const statesDelivered = await drainControlSubscriptionStateOutbox(
        control.db,
        tenantPool.db,
        tenantId,
        deliveredAt,
        batchSize,
      );
      return delivered + operationsDelivered + statesDelivered;
    },
    async readBacklog() {
      const [finance, operations, states] = await Promise.all([
        readFinanceAuditBacklog(tenantPool.db, tenantId),
        readOperationsRelayBacklog(tenantPool.db, tenantId),
        readControlSubscriptionStateBacklog(control.db, tenantId),
      ]);
      const oldestOccurredAt = [
        finance.oldestOccurredAt,
        operations.oldestOccurredAt,
        states.oldestOccurredAt,
      ]
        .filter((value): value is string => value !== undefined)
        .sort()[0];
      return {
        count: finance.pendingCount + operations.count + states.count,
        ...(oldestOccurredAt ? { oldestOccurredAt } : {}),
      };
    },
  });

  const discoverTargets = async (): Promise<readonly RelayTenantTarget[]> => {
    const targets: RelayTenantTarget[] = [];
    const routedTenantIds = new Set<VerifiedTenantId>();
    for (const [databaseUrl, tenantPool] of tenantPools) {
      const knownTenants = knownTenantsByDatabase.get(databaseUrl);
      if (!knownTenants) throw new Error('Finance audit relay database routing is unavailable.');
      const discoveredTenantIds = await listFinanceAuditRelayTenants(tenantPool.db);
      for (const tenantId of discoveredTenantIds) knownTenants.add(tenantId);
      const operationsTenantIds = await listOperationsAuditRelayTenants(tenantPool.db);
      for (const tenantId of operationsTenantIds) knownTenants.add(tenantId);
      for (const tenantId of knownTenants) {
        if (routedTenantIds.has(tenantId)) {
          throw new Error('A finance audit tenant is routed to more than one database.');
        }
        routedTenantIds.add(tenantId);
        targets.push(createTarget(tenantPool, tenantId));
      }
    }
    const pendingStateTenants = await listPendingControlSubscriptionStateTenants(control.db);
    for (const tenantId of pendingStateTenants) {
      if (!routedTenantIds.has(tenantId)) {
        throw new Error('A pending subscription state has no configured tenant database route.');
      }
    }
    return targets;
  };

  const health = new RelayHealth(
    config.tenants.map((tenant) => tenant.tenantId),
    config.readinessMaximumStaleMs,
    config.readinessMaximumBacklogCount,
    config.readinessMaximumBacklogAgeMs,
  );
  const relay = new FinanceAuditRelay(
    {
      batchSize: config.batchSize,
      pollIntervalMs: config.pollIntervalMs,
      backoff: {
        baseDelayMs: config.backoffBaseMs,
        maximumDelayMs: config.backoffMaximumMs,
        jitterRatio: config.backoffJitterRatio,
      },
    },
    {
      discoverTargets,
      health,
      logger: jsonLogger,
      probeControl: () => probeControlRelayCapability(control.client),
    },
  );
  const abortController = new AbortController();
  const healthServer = await startHealthServer(health, {
    host: config.healthHost,
    port: config.healthPort,
  });
  let stopping = false;

  const beginShutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    health.beginShutdown();
    jsonLogger.write('info', 'shutdown_started', { signal });
    abortController.abort();
  };
  process.once('SIGINT', () => beginShutdown('SIGINT'));
  process.once('SIGTERM', () => beginShutdown('SIGTERM'));
  jsonLogger.write('info', 'worker_started', {
    tenantCount: config.tenants.length,
    healthPort: config.healthPort,
    batchSize: config.batchSize,
  });

  try {
    await relay.run(abortController.signal);
  } finally {
    health.beginShutdown();
    await stopHealthServer(healthServer);
    await Promise.all([
      control.client.end({ timeout: 5 }),
      ...[...tenantPools.values()].map((pool) => pool.client.end({ timeout: 5 })),
    ]);
    jsonLogger.write('info', 'shutdown_completed');
  }
}

try {
  await main();
} catch {
  jsonLogger.write('error', 'worker_terminated_unexpectedly');
  process.exitCode = 1;
}
