#!/usr/bin/env node
/**
 * Builds one immutable, byte-reproducible source artifact for a production checkpoint.
 *
 * `git archive` is used deliberately instead of copying the working tree: it emits the
 * committed blob bytes and the committed file modes, so the archive can neither pick up a
 * developer's CRLF checkout nor lose the executable bit on the provisioning shell scripts.
 * Those are the two defects that previously broke a production deployment mid-flight.
 *
 *   node scripts/release/build-release-artifact.mjs --ref <sha> --out <directory>
 *
 * Emits `<sha>.tar` plus `<sha>.manifest.json`, which records the artifact digest and the
 * SHA-256 of every packaged migration. The migration digests are the values the deployment
 * preflight compares against the production `_orvex_migrations` ledger, so a mismatch is
 * detected before any container is recreated.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeOutputDirectory, safeToken, sha256 } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 64 MiB: `git ls-tree -r` over the whole repository comfortably exceeds the 1 MiB default.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    shell: false,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return encoding === 'buffer' ? result.stdout : result.stdout.toString(encoding);
}

export function parseArguments(argv) {
  const options = { ref: 'HEAD', out: 'artifacts/release' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--ref') options.ref = value;
    else if (flag === '--out') options.out = value;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  // Resolve to an immutable commit id: a branch name would make the artifact non-reproducible.
  const commit = git(['rev-parse', '--verify', `${options.ref}^{commit}`]).trim();
  safeToken(commit, 'Release commit');

  if (git(['status', '--porcelain']).trim() !== '') {
    throw new Error(
      'The working tree is dirty. Release artifacts are built from committed bytes only.',
    );
  }

  const outputDirectory = assertSafeOutputDirectory(path.resolve(root, options.out));
  await mkdir(outputDirectory, { recursive: true });

  // A fixed mtime keeps the tar byte-identical across rebuilds of the same commit. git writes the
  // archive itself rather than streaming through this process, which would exceed any spawn buffer.
  const archivePath = path.join(outputDirectory, `${commit}.tar`);
  git([
    'archive',
    '--format=tar',
    '--mtime=1970-01-01T00:00:00Z',
    '--prefix=orvex-isp/',
    `--output=${archivePath}`,
    commit,
  ]);
  const archiveBytes = (await stat(archivePath)).size;

  const migrationEntries = git([
    'ls-tree',
    '-r',
    '--name-only',
    commit,
    'packages/database/migrations/',
  ])
    .split('\n')
    .filter((line) => line.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const migrations = {};
  for (const entry of migrationEntries) {
    const contents = git(['show', `${commit}:${entry}`], 'buffer');
    migrations[path.basename(entry)] = createHash('sha256').update(contents).digest('hex');
  }

  const shellModes = {};
  for (const line of git(['ls-tree', '-r', commit]).split('\n')) {
    if (!line.endsWith('.sh')) continue;
    const [meta, filePath] = line.split('\t');
    shellModes[filePath] = meta.split(' ')[0];
  }

  const manifest = {
    artifactVersion: 1,
    commit,
    createdAt: new Date().toISOString(),
    archive: {
      file: path.basename(archivePath),
      bytes: archiveBytes,
      sha256: await sha256(archivePath),
    },
    // The deployment preflight compares these against production `_orvex_migrations`.
    migrations,
    // Recorded so a lost executable bit is visible in the artifact, not at provisioning time.
    shellScriptModes: shellModes,
  };

  const manifestPath = path.join(outputDirectory, `${commit}.manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Release artifact: ${archivePath}`);
  console.log(`  commit          ${commit}`);
  console.log(`  archive sha256  ${manifest.archive.sha256}`);
  console.log(`  migrations      ${Object.keys(migrations).length}`);
  console.log(`  shell scripts   ${Object.keys(shellModes).length}`);
  console.log(`Manifest: ${manifestPath}`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { main };

// Re-exported so the deployment runbook can verify a downloaded artifact without re-reading git.
export async function readManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}
