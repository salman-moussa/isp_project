import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'outputs/release/release-evidence.json');
const candidate = process.argv[3];
if (!candidate || !/^[a-zA-Z0-9._-]+$/.test(candidate)) {
  throw new Error('Usage: node scripts/release/create-evidence-record.mjs OUTPUT CANDIDATE');
}
const gates = [
  'static-validation-and-build',
  'migration-and-live-postgres',
  'tenant-isolation-and-authorization',
  'finance-and-idempotency-invariants',
  'accessibility-localization-visual',
  'security-scans-and-dast',
  'telemetry-privacy-and-cardinality',
  'reference-load-and-soak',
  'alert-routing-drills',
  'encrypted-backup-and-isolated-restore',
  'application-rollback-rehearsal',
  'staging-deployment-and-smoke',
].map((id) => ({ id, result: 'missing', evidence: [] }));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      candidate,
      createdAt: new Date().toISOString(),
      decision: 'blocked',
      immutableArtifactDigests: [],
      gates,
      measuredObjectives: [],
      residualRisks: [],
      approvals: [],
      note: 'A generated record is a checklist, not evidence. Missing gates keep the candidate blocked.',
    },
    null,
    2,
  )}\n`,
  { flag: 'wx' },
);
console.log(`Blocked release evidence record created at ${output}`);
