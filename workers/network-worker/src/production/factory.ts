import { RouterEgressPolicy } from '../egress.js';
import { RouterCircuitBreaker, RouterConcurrencyLimiter, type RetryPolicy } from '../policy.js';
import { NetworkWorker } from '../worker.js';
import { PostgresDurableNetworkStore, type ParameterizedSqlClient } from './postgres-store.js';
import { RouterOsRestAdapter, type SecretReferenceResolver } from './routeros-rest.js';

export interface ProductionNetworkWorkerOptions {
  readonly sql: ParameterizedSqlClient;
  readonly workerId: string;
  readonly allowedRouterOrigins: readonly string[];
  readonly secrets: SecretReferenceResolver;
  readonly timeoutMs: number;
  readonly leaseDurationMs?: number;
  readonly concurrencyPerRouter?: number;
  readonly circuitFailureThreshold?: number;
  readonly circuitResetAfterMs?: number;
  readonly retryPolicy?: RetryPolicy;
}

export function createProductionNetworkWorker(
  options: ProductionNetworkWorkerOptions,
): NetworkWorker {
  const store = new PostgresDurableNetworkStore(
    options.sql,
    options.workerId,
    options.leaseDurationMs,
  );
  const adapter = new RouterOsRestAdapter({
    allowedOrigins: options.allowedRouterOrigins,
    secrets: options.secrets,
  });
  return new NetworkWorker(
    store,
    adapter,
    new RouterEgressPolicy(options.allowedRouterOrigins),
    new RouterConcurrencyLimiter(options.concurrencyPerRouter ?? 1),
    new RouterCircuitBreaker({
      failureThreshold: options.circuitFailureThreshold ?? 3,
      resetAfterMs: options.circuitResetAfterMs ?? 30_000,
    }),
    {
      timeoutMs: options.timeoutMs,
      ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    },
  );
}
