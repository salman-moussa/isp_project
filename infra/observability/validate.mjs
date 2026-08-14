import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const catalog = JSON.parse(await readFile(path.join(here, 'alert-catalog.json'), 'utf8'));
const rules = await readFile(path.join(here, 'prometheus-rules.yml'), 'utf8');
const collector = await readFile(path.join(here, 'otel-collector.yaml'), 'utf8');
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.alerts))
  throw new Error('Invalid catalog.');
const names = new Set();
for (const alert of catalog.alerts) {
  for (const field of ['name', 'severity', 'owner', 'dedupKey', 'threshold', 'runbook']) {
    if (!alert[field]) throw new Error(`${alert.name ?? 'alert'} is missing ${field}.`);
  }
  if (names.has(alert.name)) throw new Error(`Duplicate alert ${alert.name}.`);
  names.add(alert.name);
  if (!rules.includes(`alert: ${alert.name}`)) throw new Error(`${alert.name} has no rule.`);
  if (!rules.includes(`runbook: ${alert.runbook}`))
    throw new Error(`${alert.name} rule lacks runbook.`);
  await access(path.join(root, alert.runbook));
}
const forbiddenCollectorTokens = ['debug:', 'logging:', 'insecure: true'];
for (const token of forbiddenCollectorTokens) {
  if (collector.includes(token)) throw new Error(`Unsafe collector token: ${token}`);
}
for (const required of ['memory_limiter', 'transform/redact', 'resource/redact', 'batch']) {
  if (!collector.includes(required)) throw new Error(`Collector missing ${required}.`);
}
console.log(`Validated ${names.size} alerts, runbook mappings, and collector safety processors.`);
