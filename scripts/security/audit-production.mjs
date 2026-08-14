import { spawnSync } from 'node:child_process';

const exception = {
  package: 'image-size',
  expiresOn: '2026-09-15',
  advisoryUrls: new Set([
    'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
    'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  ]),
};

const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const args =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd audit --omit=dev --json']
    : ['audit', '--omit=dev', '--json'];
const audit = spawnSync(command, args, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  shell: false,
});
if (audit.error) throw audit.error;

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr || audit.stdout || 'npm audit did not return JSON.\n');
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const blockingSeverities = new Set(['critical', 'high']);
const allowed = new Set();
const imageSize = vulnerabilities[exception.package];
if (imageSize && blockingSeverities.has(imageSize.severity)) {
  const advisoryUrls = imageSize.via
    .filter((entry) => typeof entry === 'object' && entry !== null)
    .map((entry) => entry.url);
  const hasOnlyApprovedAdvisories =
    advisoryUrls.length === exception.advisoryUrls.size &&
    advisoryUrls.every((url) => exception.advisoryUrls.has(url));
  const affectsOnlyMetro =
    Array.isArray(imageSize.effects) &&
    imageSize.effects.length > 0 &&
    imageSize.effects.every((name) => name === 'metro');
  if (hasOnlyApprovedAdvisories && affectsOnlyMetro) allowed.add(exception.package);
}

let changed = true;
while (changed) {
  changed = false;
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (allowed.has(name) || !blockingSeverities.has(vulnerability.severity)) continue;
    if (
      vulnerability.via.length > 0 &&
      vulnerability.via.every((entry) => typeof entry === 'string') &&
      vulnerability.via.some((entry) => allowed.has(entry))
    ) {
      allowed.add(name);
      changed = true;
    }
  }
}

const blockers = Object.entries(vulnerabilities).filter(
  ([name, vulnerability]) => blockingSeverities.has(vulnerability.severity) && !allowed.has(name),
);
if (blockers.length > 0) {
  for (const [name, vulnerability] of blockers) {
    process.stderr.write(
      `${vulnerability.severity.toUpperCase()}: ${name} (${vulnerability.range})\n`,
    );
  }
  process.exit(1);
}

if (allowed.size > 0) {
  const today = new Date().toISOString().slice(0, 10);
  if (today > exception.expiresOn) {
    process.stderr.write(
      `The image-size build-tool exception expired on ${exception.expiresOn}.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `Accepted until ${exception.expiresOn}: unpatched image-size advisories propagate only through Expo/Metro build tooling (${[...allowed].sort().join(', ')}).\n`,
  );
}

const counts = report.metadata?.vulnerabilities ?? {};
process.stdout.write(
  `Production dependency audit passed: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high (${allowed.size} build-graph entries excepted), ${counts.moderate ?? 0} moderate.\n`,
);
