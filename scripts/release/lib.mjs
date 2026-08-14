import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function requireEnv(name, expected) {
  const value = process.env[name];
  if (!value || (expected && value !== expected))
    throw new Error(`Required environment value: ${name}`);
  return value;
}

export function safeToken(value, label) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${label} contains unsafe characters.`);
  return value;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

export async function sha256(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

export function assertSafeOutputDirectory(directory) {
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root)
    throw new Error('A filesystem root is not a safe output directory.');
  return resolved;
}
