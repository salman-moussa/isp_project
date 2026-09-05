#!/usr/bin/env node
/**
 * Release packaging integrity gate.
 *
 * A production deployment reads migration bytes to recompute SHA-256 checksums and
 * executes packaged shell scripts inside Alpine. A CRLF checkout or a lost executable
 * bit therefore breaks deployment in two ways that are invisible in a code review:
 *
 *   1. A content-identical migration produces a different checksum and the migrator
 *      refuses to continue with "Applied migration ... has changed".
 *   2. `/admin/*.sh` is packaged non-executable and the provisioning container fails.
 *
 * This gate asserts the committed bytes in the git index, not the working tree, so the
 * result is independent of the developer's `core.autocrlf` setting.
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'buffer', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

const CRLF_EXEMPT_EXTENSIONS = new Set(['.bat', '.cmd']);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.jar',
  '.keystore',
  '.zip',
  '.gz',
  '.tgz',
]);

export function parseIndexEntries(stdout) {
  return stdout
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [meta, filePath] = line.split('\t');
      const [mode, objectId] = meta.split(' ');
      return { mode, objectId, path: filePath };
    });
}

export function isExecutableMode(mode) {
  return mode === '100755';
}

export function containsCarriageReturn(buffer) {
  return buffer.includes(0x0d);
}

export function isProbablyBinary(buffer) {
  return buffer.includes(0x00);
}

/**
 * Parses `.gitattributes` into `pattern -> normalized attribute list`, ignoring
 * comments and blank lines. Plain parsing keeps the gate readable and avoids
 * treating the glob patterns themselves as regular expressions.
 */
export function parseAttributeRules(text) {
  const rules = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    rules.set(parts[0], parts.slice(1).join(' '));
  }
  return rules;
}

/**
 * Migration file names must stay forward-only under the exact ordering the migrator
 * uses (`localeCompare`), because a name that sorts before an already-applied
 * migration would replay out of order against production.
 *
 * `0000_identity_tenancy_audit.sql` predates the UTC-stamp convention and is applied
 * in production, so it is immutable and accepted by name; every later migration must
 * use the stamped convention.
 */
const LEGACY_MIGRATION_NAMES = new Set(['0000_identity_tenancy_audit.sql']);
const STAMPED_MIGRATION_NAME = /^\d{12}_[a-z0-9_]+\.sql$/;

export function assertForwardOnlyMigrationNames(names) {
  const failures = [];
  const seen = new Set();
  let previous = '';
  for (const name of names) {
    if (!LEGACY_MIGRATION_NAMES.has(name) && !STAMPED_MIGRATION_NAME.test(name)) {
      failures.push(`${name}: expected <YYYYMMDDHHmm>_<snake_case>.sql`);
      continue;
    }
    if (seen.has(name)) failures.push(`${name}: duplicate migration name`);
    seen.add(name);
    if (previous !== '' && name.localeCompare(previous) <= 0) {
      failures.push(`${name}: sorts at or before the preceding migration ${previous}`);
    }
    previous = name;
  }
  return failures;
}

async function main() {
  const failures = [];

  // 1. The normalization contract itself must be committed.
  const attributes = await readFile(path.join(root, '.gitattributes'), 'utf8').catch(() => null);
  if (attributes === null) {
    failures.push('.gitattributes is missing; checkouts are not normalized to LF.');
  } else {
    const rules = parseAttributeRules(attributes);
    if (rules.get('*') !== 'text=auto eol=lf') {
      failures.push('.gitattributes must declare `* text=auto eol=lf` as the repository default.');
    }
    for (const pattern of ['*.sql', '*.sh', '*.mjs', '*.yml']) {
      if (rules.get(pattern) !== 'text eol=lf') {
        failures.push(`.gitattributes must pin ${pattern} to \`text eol=lf\`.`);
      }
    }
  }

  const entries = parseIndexEntries(git(['ls-files', '-s']));

  // 2. Shell scripts must be packaged executable.
  for (const entry of entries) {
    if (entry.path.endsWith('.sh') && !isExecutableMode(entry.mode)) {
      failures.push(`${entry.path}: committed mode ${entry.mode}, expected 100755 (executable).`);
    }
  }

  // 3. No committed text blob may carry CR, which would change migration checksums.
  for (const entry of entries) {
    const extension = path.extname(entry.path).toLowerCase();
    if (CRLF_EXEMPT_EXTENSIONS.has(extension) || BINARY_EXTENSIONS.has(extension)) continue;
    const blob = git(['cat-file', 'blob', entry.objectId]);
    if (isProbablyBinary(blob)) continue;
    if (containsCarriageReturn(blob)) {
      failures.push(`${entry.path}: committed bytes contain CR; LF-only is required.`);
    }
    if (
      entry.path.endsWith('.sql') &&
      blob.length >= 3 &&
      blob.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ) {
      failures.push(`${entry.path}: committed bytes start with a UTF-8 BOM.`);
    }
  }

  // 4. Migration names must stay forward-only and fully scoped.
  const migrationNames = entries
    .filter((entry) => entry.path.startsWith('packages/database/migrations/'))
    .map((entry) => path.basename(entry.path))
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  failures.push(...assertForwardOnlyMigrationNames(migrationNames));

  const scopes = JSON.parse(
    await readFile(path.join(root, 'packages/database/migration-scopes.json'), 'utf8'),
  );
  for (const name of migrationNames) {
    if (!['control', 'tenant', 'both'].includes(scopes[name])) {
      failures.push(`${name}: missing or invalid database-plane scope in migration-scopes.json.`);
    }
  }
  for (const name of Object.keys(scopes)) {
    if (!migrationNames.includes(name)) {
      failures.push(`migration-scopes.json references missing migration ${name}.`);
    }
  }

  if (failures.length > 0) {
    console.error('Release packaging gate failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Release packaging verified: ${entries.length} tracked files, ` +
      `${migrationNames.length} forward-only migrations, LF-only text, executable shell scripts.`,
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
