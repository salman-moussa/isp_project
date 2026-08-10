import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scanRoots = [
  'README.md',
  'AGENTS.md',
  'package.json',
  '.env.example',
  'docker-compose.yml',
  'docker-compose.test.yml',
  '.github',
  'apps',
  'infra',
  'packages/ui',
  'docs',
];
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.tf',
  '.tfvars',
  '.sh',
  '.yaml',
  '.yml',
]);
const ignoredDirectories = new Set(['node_modules', '.git', 'coverage']);
const ignoredFiles = new Set([
  'docs/adr/0011-product-identity-and-legacy-identifiers.md',
  'docs/audits/foundation-audit-2026-08-09.md',
  'docs/ux/product-identity-migration-checklist.md',
]);
const obsoleteNames = [
  { label: 'temporary Cedar Ops identity', pattern: /Cedar Ops/giu },
  { label: 'temporary Lebanon ISP product name', pattern: /Lebanon ISP Operations Platform/giu },
  { label: 'temporary Lebanon ISP token issuer', pattern: /lebanon-isp-platform/giu },
  { label: 'personal vendor identity', pattern: /Salman Moussa(?:'s Team)?/giu },
  { label: 'unqualified Control Center name', pattern: /(?<!Orvex ISP )Platform Control Center/gu },
  {
    label: 'temporary ISP Operations Workspace name',
    pattern: /(?<!Orvex )ISP Operations Workspace/gu,
  },
  { label: 'Arabic temporary Cedar Ops identity', pattern: /سيدر أوبس/gu },
  { label: 'Arabic personal vendor identity', pattern: /فريق سلمان موسى/gu },
];

async function collectFiles(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) return [path];

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    else if (textExtensions.has(extname(entry.name).toLowerCase())) files.push(child);
  }
  return files;
}

const files = (
  await Promise.all(scanRoots.map((path) => collectFiles(resolve(repositoryRoot, path))))
).flat();
const findings = [];

for (const file of files) {
  if (ignoredFiles.has(relative(repositoryRoot, file).replaceAll('\\', '/'))) continue;
  const content = await readFile(file, 'utf8');
  const lines = content.split(/\r?\n/u);
  for (const { label, pattern } of obsoleteNames) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split(/\r?\n/u).length;
      const excerpt = lines[line - 1].trim().replace(/\s+/gu, ' ').slice(0, 180);
      findings.push(`${relative(repositoryRoot, file)}:${line}: ${label}: ${excerpt}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Obsolete user-facing product identity found:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Brand check passed across ${files.length} user-facing source and artifact files.`);
}
