import type { SessionClaims } from '@isp/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { MemoryAuditWriter } from './audit.js';
import type { SessionStatusReader } from './authentication.js';

const config = {
  NODE_ENV: 'test' as const,
  HOST: '127.0.0.1',
  PORT: 3000,
  JWT_SECRET: 'test-only-secret-that-is-at-least-thirty-two-characters',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  CORS_ORIGINS: 'http://localhost:5173',
};

const tenantClaims: SessionClaims = {
  sub: 'user-a',
  sessionId: 'session-a',
  audience: 'tenant',
  tenantId: 'tenant-a',
  permissions: ['tenant.dashboard.view'],
};

describe('identity -> tenant -> permission -> audit slice', () => {
  let app: FastifyInstance;
  let audit: MemoryAuditWriter;
  const now = new Date('2026-08-09T18:00:00.000Z');

  beforeEach(async () => {
    audit = new MemoryAuditWriter();
    const sessions: SessionStatusReader = {
      isActive: async (sessionId) => sessionId !== 'revoked-session',
    };
    app = await buildApp(config, {
      audit,
      now: () => now,
      sessions,
      supportGrants: { isActive: async (grantId) => grantId !== 'revoked-grant' },
    });
    await app.ready();
  });

  afterEach(async () => app.close());

  const tokenFor = (claims: SessionClaims) => app.jwt.sign(claims);

  it('returns a currency-separated tenant summary and writes audit evidence', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-a/summary',
      headers: { authorization: `Bearer ${tokenFor(tenantClaims)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenantId: 'tenant-a',
      collections: { USD: 0, LBP: 0 },
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      action: 'tenant.summary.read',
      result: 'allowed',
    });
  });

  it('denies a verified user from another tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-b/summary',
      headers: { authorization: `Bearer ${tokenFor(tenantClaims)}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTHORIZATION_DENIED');
    expect(audit.events[0]).toMatchObject({ result: 'denied', tenantId: 'tenant-b' });
  });

  it('denies a tenant user without the explicit permission', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-a/summary',
      headers: {
        authorization: `Bearer ${tokenFor({ ...tenantClaims, permissions: [] })}`,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a revoked session even when its signed token has not expired', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-a/summary',
      headers: {
        authorization: `Bearer ${tokenFor({ ...tenantClaims, sessionId: 'revoked-session' })}`,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('allows only an active scoped support grant and audits its grant id', async () => {
    const supportClaims: SessionClaims = {
      sub: 'support-agent-a',
      sessionId: 'platform-session-a',
      audience: 'platform',
      permissions: ['platform.support.request'],
      supportGrant: {
        grantId: 'grant-a',
        tenantId: 'tenant-a',
        ticketId: 'ticket-a',
        approverId: 'support-manager-a',
        reason: 'Investigate an approved billing display incident',
        permissions: ['tenant.dashboard.view'],
        expiresAt: '2026-08-09T18:15:00.000Z',
      },
    };

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-a/summary',
      headers: { authorization: `Bearer ${tokenFor(supportClaims)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(audit.events[0]).toMatchObject({
      supportGrantId: 'grant-a',
      action: 'support.tenant.summary.read',
    });
  });

  it('rejects an expired support grant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-a/summary',
      headers: {
        authorization: `Bearer ${tokenFor({
          sub: 'support-agent-a',
          sessionId: 'platform-session-a',
          audience: 'platform',
          permissions: [],
          supportGrant: {
            grantId: 'grant-a',
            tenantId: 'tenant-a',
            ticketId: 'ticket-a',
            approverId: 'support-manager-a',
            reason: 'Investigate an approved billing display incident',
            permissions: ['tenant.dashboard.view'],
            expiresAt: '2026-08-09T17:59:59.000Z',
          },
        })}`,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not record an allowed outcome when the tenant read fails', async () => {
    await app.close();
    audit = new MemoryAuditWriter();
    app = await buildApp(config, {
      audit,
      now: () => now,
      sessions: { isActive: async () => true },
      summaries: {
        read: async () => {
          throw new Error('database unavailable');
        },
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tenants/tenant-a/summary',
      headers: { authorization: `Bearer ${tokenFor(tenantClaims)}` },
    });

    expect(response.statusCode).toBe(500);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ result: 'failed' });
  });
});
