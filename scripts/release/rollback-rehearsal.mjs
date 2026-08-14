import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { requireEnv, sha256 } from './lib.mjs';

requireEnv('ORVEX_ROLLBACK_ACK', 'nonproduction-rehearsal-authorized');
const currentDigest = requireEnv('ORVEX_ROLLBACK_CURRENT_DIGEST');
const previousDigest = requireEnv('ORVEX_ROLLBACK_PREVIOUS_DIGEST');
for (const digest of [currentDigest, previousDigest]) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error('Artifact digests must be sha256 digests.');
}
if (currentDigest === previousDigest) throw new Error('Current and previous digests must differ.');
const compatibilityEvidence = path.resolve(requireEnv('ORVEX_ROLLBACK_COMPATIBILITY_EVIDENCE'));
const preSmokeEvidence = path.resolve(requireEnv('ORVEX_ROLLBACK_PRE_SMOKE_EVIDENCE'));
const postSmokeEvidence = path.resolve(requireEnv('ORVEX_ROLLBACK_POST_SMOKE_EVIDENCE'));
for (const file of [compatibilityEvidence, preSmokeEvidence, postSmokeEvidence]) {
  await access(file);
  if ((await readFile(file)).length === 0) throw new Error(`Evidence is empty: ${file}`);
}
const output = path.resolve(requireEnv('ORVEX_ROLLBACK_EVIDENCE_OUTPUT'));
const record = {
  schemaVersion: 1,
  evidenceKind: 'application-rollback-rehearsal-input-verification',
  recordedAt: new Date().toISOString(),
  currentDigest,
  previousDigest,
  evidenceChecksums: {
    schemaCompatibility: await sha256(compatibilityEvidence),
    currentArtifactSmoke: await sha256(preSmokeEvidence),
    previousArtifactSmokeAfterRollback: await sha256(postSmokeEvidence),
  },
  databaseRollbackExecuted: false,
  orchestratorRollbackExecutedByThisScript: false,
  limitations: [
    'This script verifies captured rehearsal inputs; it does not execute an external deployment.',
    'The deployment system record, time-to-recover, alert recovery and accepted-work reconciliation must be attached separately.',
  ],
};
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(`Rollback rehearsal record: ${output}`);
