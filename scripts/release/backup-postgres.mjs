import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeOutputDirectory, requireEnv, run, safeToken, sha256 } from './lib.mjs';

requireEnv('ORVEX_BACKUP_ACK', 'encrypted-backup-authorized');
const service = safeToken(requireEnv('ORVEX_BACKUP_PGSERVICE'), 'PGSERVICE');
const scope = safeToken(requireEnv('ORVEX_BACKUP_SCOPE'), 'backup scope');
const recipient = requireEnv('ORVEX_BACKUP_AGE_RECIPIENT');
if (!recipient.startsWith('age1'))
  throw new Error('Only an age X25519 public recipient is accepted.');
const outputDirectory = assertSafeOutputDirectory(requireEnv('ORVEX_BACKUP_OUTPUT_DIR'));
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const base = `orvex-${scope}-${timestamp}`;
const plaintext = path.join(outputDirectory, `${base}.dump`);
const encrypted = path.join(outputDirectory, `${base}.dump.age`);
const manifestPath = path.join(outputDirectory, `${base}.manifest.json`);
for (const candidate of [plaintext, encrypted, manifestPath]) {
  try {
    await access(candidate);
    throw new Error(`Refusing to overwrite ${candidate}.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

try {
  run('pg_dump', [
    '--dbname',
    `service=${service}`,
    '--format=custom',
    '--compress=9',
    '--no-owner',
    '--no-privileges',
    '--file',
    plaintext,
  ]);
  run('pg_restore', ['--list', plaintext]);
  run('age', ['--recipient', recipient, '--output', encrypted, plaintext]);
  const checksum = await sha256(encrypted);
  const manifest = {
    schemaVersion: 1,
    evidenceKind: 'encrypted-postgres-backup-preparation',
    createdAt: new Date().toISOString(),
    scope,
    databaseServiceReference: service,
    archive: path.basename(encrypted),
    archiveSha256: checksum,
    encryption: 'age-x25519',
    archiveFormat: 'postgres-custom',
    offHostCopyVerified: false,
    restoreVerified: false,
    limitations: [
      'This manifest proves local dump readability and encryption only.',
      'Off-host receipt, retention, isolated restore, application smoke, RPO and RTO remain unverified.',
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`Encrypted backup: ${encrypted}`);
  console.log(`Manifest: ${manifestPath}`);
} finally {
  await rm(plaintext, { force: true });
}
