import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith('--') || value === undefined)
    throw new Error(`Invalid argument near ${key}.`);
  args.set(key.slice(2), value);
}

const scenarioName = args.get('scenario') ?? 'local-smoke';
const target = new URL(
  args.get('target') ?? process.env.ORVEX_LOAD_TARGET ?? 'http://127.0.0.1:3000',
);
const output = path.resolve(args.get('out') ?? `outputs/performance/${scenarioName}.json`);
const configPath = path.resolve(args.get('config') ?? path.join(here, 'scenarios.json'));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const scenario = config.scenarios?.[scenarioName];
if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
if (!localHosts.has(target.hostname)) {
  const allowedHosts = new Set(
    (process.env.ORVEX_LOAD_ALLOW_HOSTS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    process.env.ORVEX_LOAD_ACK !== 'authorized-nonproduction-target' ||
    !allowedHosts.has(target.hostname)
  ) {
    throw new Error(
      'Remote load is denied. Set ORVEX_LOAD_ACK=authorized-nonproduction-target and explicitly allow the exact hostname.',
    );
  }
  if (target.protocol !== 'https:') throw new Error('Remote load targets must use HTTPS.');
}
if (
  scenario.durationSeconds > 1800 &&
  process.env.ORVEX_LOAD_EXTENDED_ACK !== 'authorized-extended-staging-run'
) {
  throw new Error(
    'Runs over 30 minutes require ORVEX_LOAD_EXTENDED_ACK=authorized-extended-staging-run.',
  );
}
if (scenario.requestsPerSecond > 100 || scenario.maxInFlight > 50) {
  throw new Error('Harness hard ceiling exceeded (100 requests/s or 50 in flight).');
}

let headers = {};
if (process.env.ORVEX_LOAD_HEADERS_JSON) {
  headers = JSON.parse(process.env.ORVEX_LOAD_HEADERS_JSON);
  if (!headers || Array.isArray(headers) || typeof headers !== 'object') {
    throw new Error('ORVEX_LOAD_HEADERS_JSON must be a JSON object.');
  }
}

const weighted = scenario.endpoints.flatMap((endpoint) =>
  Array.from({ length: endpoint.weight }, () => endpoint),
);
const latencies = [];
const statusCounts = {};
const errorCounts = {};
let attempted = 0;
let completed = 0;
let inFlight = 0;
let skippedForBackpressure = 0;
let endpointCursor = 0;
const startWall = new Date();
const start = performance.now();
const endAt = start + scenario.durationSeconds * 1000;
const intervalMs = 1000 / scenario.requestsPerSecond;

async function issue(endpoint) {
  attempted += 1;
  inFlight += 1;
  const requestStart = performance.now();
  try {
    const response = await fetch(new URL(endpoint.path, target), {
      method: endpoint.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(scenario.requestTimeoutMs),
    });
    await response.body?.cancel();
    statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
    if (!endpoint.expectedStatuses.includes(response.status)) {
      const key = `unexpected_status_${response.status}`;
      errorCounts[key] = (errorCounts[key] ?? 0) + 1;
    }
  } catch (error) {
    const key = error?.name === 'TimeoutError' ? 'timeout' : 'transport';
    errorCounts[key] = (errorCounts[key] ?? 0) + 1;
  } finally {
    latencies.push(performance.now() - requestStart);
    completed += 1;
    inFlight -= 1;
  }
}

let nextAt = performance.now();
const pending = new Set();
while (performance.now() < endAt) {
  const now = performance.now();
  if (now < nextAt) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(nextAt - now, 25)));
    continue;
  }
  if (now - nextAt > intervalMs) {
    skippedForBackpressure += Math.floor((now - nextAt) / intervalMs);
    nextAt = now;
  }
  nextAt += intervalMs;
  if (inFlight >= scenario.maxInFlight) {
    skippedForBackpressure += 1;
    continue;
  }
  const endpoint = weighted[endpointCursor % weighted.length];
  endpointCursor += 1;
  const task = issue(endpoint).finally(() => pending.delete(task));
  pending.add(task);
}
await Promise.all(pending);

latencies.sort((left, right) => left - right);
const percentile = (fraction) =>
  latencies.length === 0 ? null : latencies[Math.ceil(latencies.length * fraction) - 1];
const errorCount = Object.values(errorCounts).reduce((sum, count) => sum + count, 0);
const errorRate = completed === 0 ? 1 : errorCount / completed;
const p95Ms = percentile(0.95);
const assertions = {
  errorRate: {
    actual: errorRate,
    maximum: scenario.thresholds.errorRateMax,
    passed: errorRate <= scenario.thresholds.errorRateMax,
  },
  p95Ms: {
    actual: p95Ms,
    maximum: scenario.thresholds.p95MsMax,
    passed: p95Ms !== null && p95Ms <= scenario.thresholds.p95MsMax,
  },
  backpressure: {
    actualSkipped: skippedForBackpressure,
    passed: skippedForBackpressure === 0,
  },
};
const report = {
  schemaVersion: 1,
  evidenceKind: 'measured-harness-run',
  scenario: scenarioName,
  scenarioDescription: scenario.description,
  targetOrigin: target.origin,
  startedAt: startWall.toISOString(),
  finishedAt: new Date().toISOString(),
  configured: {
    durationSeconds: scenario.durationSeconds,
    requestsPerSecond: scenario.requestsPerSecond,
    maxInFlight: scenario.maxInFlight,
    requestTimeoutMs: scenario.requestTimeoutMs,
  },
  results: {
    attempted,
    completed,
    skippedForBackpressure,
    statusCounts,
    errorCounts,
    errorRate,
    latencyMs: {
      p50: percentile(0.5),
      p95: p95Ms,
      p99: percentile(0.99),
      max: latencies.at(-1) ?? null,
    },
  },
  assertions,
  limitations: [
    'This harness report proves only the configured HTTP workload on the recorded target.',
    'It does not prove tenant isolation, idempotency, queue correctness, database capacity, or fleet scale.',
    'Headers and response bodies are intentionally excluded from evidence.',
  ],
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(`Performance evidence written to ${output}`);
if (!Object.values(assertions).every((assertion) => assertion.passed)) process.exitCode = 1;
