import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, 'scenarios.json'), 'utf8'));
if (config.schemaVersion !== 1 || !config.scenarios)
  throw new Error('Unsupported scenario schema.');
for (const [name, scenario] of Object.entries(config.scenarios)) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsafe scenario name: ${name}`);
  for (const field of ['durationSeconds', 'requestsPerSecond', 'maxInFlight', 'requestTimeoutMs']) {
    if (!Number.isInteger(scenario[field]) || scenario[field] <= 0) {
      throw new Error(`${name}.${field} must be a positive integer.`);
    }
  }
  if (scenario.requestsPerSecond > 100 || scenario.maxInFlight > 50) {
    throw new Error(`${name} exceeds the harness hard ceiling.`);
  }
  if (!scenario.endpoints?.length) throw new Error(`${name} has no endpoints.`);
  const totalWeight = scenario.endpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);
  if (totalWeight > 1000)
    throw new Error(`${name} endpoint weights exceed the safe expansion cap.`);
  for (const endpoint of scenario.endpoints) {
    if (!['GET', 'HEAD'].includes(endpoint.method))
      throw new Error(`${name} has a mutating endpoint.`);
    if (!endpoint.path.startsWith('/') || endpoint.path.includes('..')) {
      throw new Error(`${name} has an unsafe endpoint path.`);
    }
    if (!Number.isInteger(endpoint.weight) || endpoint.weight <= 0) {
      throw new Error(`${name} has an invalid endpoint weight.`);
    }
    if (!endpoint.expectedStatuses?.every(Number.isInteger)) {
      throw new Error(`${name} has invalid expected status values.`);
    }
  }
}
console.log(`Validated ${Object.keys(config.scenarios).length} bounded performance scenarios.`);
