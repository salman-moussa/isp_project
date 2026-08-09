import { spawn } from 'node:child_process';

const port = 32199;
const child = spawn(process.execPath, ['apps/api/dist/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    JWT_SECRET: 'artifact-smoke-only-secret-at-least-32-characters',
    SUPPORT_TOKEN_ISSUER: 'orvex-isp-artifact-smoke',
    SUPPORT_TOKEN_AUDIENCE: 'orvex-isp-api-artifact-smoke',
    CONTROL_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/control',
    TENANT_DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/tenant',
    CORS_ORIGINS: 'http://localhost:4173',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let diagnostics = '';
child.stdout.on('data', (chunk) => {
  diagnostics += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  diagnostics += chunk.toString();
});

const deadline = Date.now() + 15_000;
let healthy = false;
try {
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // The listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
}

if (!healthy) {
  console.error('Compiled API artifact did not become healthy.');
  console.error(diagnostics);
  process.exitCode = 1;
} else {
  console.log('Compiled API artifact smoke check passed.');
}
