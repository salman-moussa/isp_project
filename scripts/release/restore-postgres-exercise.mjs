import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireEnv, run, safeToken, sha256 } from './lib.mjs';

requireEnv('ORVEX_RESTORE_ACK', 'isolated-nonproduction-restore-authorized');
const service = safeToken(requireEnv('ORVEX_RESTORE_PGSERVICE'), 'PGSERVICE');
const target = safeToken(requireEnv('ORVEX_RESTORE_TARGET_DATABASE'), 'restore database');
if (!target.startsWith('orvex_restore_exercise_')) {
  throw new Error('Restore database must start with orvex_restore_exercise_.');
}
const archive = path.resolve(requireEnv('ORVEX_RESTORE_ARCHIVE'));
const manifestPath = path.resolve(requireEnv('ORVEX_RESTORE_MANIFEST'));
const identity = path.resolve(requireEnv('ORVEX_RESTORE_AGE_IDENTITY_FILE'));
const evidencePath = path.resolve(requireEnv('ORVEX_RESTORE_EVIDENCE_OUTPUT'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (path.basename(archive) !== manifest.archive)
  throw new Error('Archive does not match manifest.');
if ((await sha256(archive)) !== manifest.archiveSha256)
  throw new Error('Encrypted archive checksum mismatch.');

const temporary = await mkdtemp(path.join(os.tmpdir(), 'orvex-restore-'));
const plaintext = path.join(temporary, 'archive.dump');
const startedAt = new Date();
try {
  run('age', ['--decrypt', '--identity', identity, '--output', plaintext, archive]);
  run('pg_restore', ['--list', plaintext]);
  run('createdb', ['--maintenance-db', `service=${service}`, target]);
  run('pg_restore', [
    '--dbname',
    `service=${service} dbname=${target}`,
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    plaintext,
  ]);
  run('psql', [
    '--dbname',
    `service=${service} dbname=${target}`,
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    'SELECT current_database(), count(*) FROM pg_catalog.pg_class;',
  ]);
  const finishedAt = new Date();
  const evidence = {
    schemaVersion: 1,
    evidenceKind: 'isolated-postgres-archive-restore',
    sourceManifestSha256: await sha256(manifestPath),
    sourceArchiveSha256: manifest.archiveSha256,
    targetDatabase: target,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
    archiveChecksumVerified: true,
    archiveListingVerified: true,
    restoreCommandCompleted: true,
    connectivityVerified: true,
    applicationSmokeVerified: false,
    domainReconciliationVerified: false,
    objectRestoreVerified: false,
    rpoMeasured: false,
    limitations: [
      'The exercise database is intentionally retained for domain reconciliation and application smoke.',
      'This record alone is not a successful disaster-recovery exercise or RPO/RTO claim.',
    ],
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`Restore evidence: ${evidencePath}`);
  console.log(`Exercise database retained: ${target}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
