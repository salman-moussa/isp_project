import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const required = [
  'docs/performance/capacity-model.md',
  'docs/performance/scaling-and-backpressure.md',
  'docs/performance/load-and-soak-plan.md',
  'docs/performance/benchmark-report-template.md',
  'docs/release/deployment-profiles.md',
  'docs/release/observability-contract.md',
  'docs/release/backup-restore-rollback.md',
  'docs/release/final-release-evidence-template.md',
  'infra/performance/scenarios.json',
  'infra/observability/otel-collector.yaml',
  'infra/observability/alert-catalog.json',
  'scripts/release/backup-postgres.mjs',
  'scripts/release/restore-postgres-exercise.mjs',
  'scripts/release/rollback-rehearsal.mjs',
];
for (const relative of required) await access(path.join(root, relative));

for (const relative of [
  'docs/performance/capacity-model.md',
  'docs/performance/benchmark-report-template.md',
  'docs/release/final-release-evidence-template.md',
]) {
  const text = (await readFile(path.join(root, relative), 'utf8')).toLowerCase();
  if (!text.includes('not') && !text.includes('missing') && !text.includes('blocked')) {
    throw new Error(`${relative} does not state its unmeasured/blocked status.`);
  }
}

for (const script of ['infra/performance/validate.mjs', 'infra/observability/validate.mjs']) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`${script} failed.`);
}
console.log(`Validated Phase G static kit (${required.length} required artifacts).`);
