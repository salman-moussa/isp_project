import type { SessionClaims } from '@isp/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { MemoryAuditWriter } from './audit.js';
import type { SessionStatusReader } from './authentication.js';
import { MemorySecurityAuditWriter } from './security-audit.js';

const config = {
  NODE_ENV: 'test' as const,
  HOST: '127.0.0.1',
  PORT: 3000,
  JWT_SECRET: 'test-only-secret-that-is-at-least-thirty-two-characters',
  SUPPORT_TOKEN_ISSUER: 'orvex-isp-test',
  SUPPORT_TOKEN_AUDIENCE: 'orvex-isp-api-test',
  CONTROL_DATABASE_URL: 'postgres://test:test@localhost:5432/control_test',
  TENANT_DATABASE_URL: 'postgres://test:test@localhost:5432/tenant_test',
  CORS_ORIGINS: 'http://localhost:5173',
};

const tenantA = '00000000-0000-4000-8000-00000000000a';
const tenantB = '00000000-0000-4000-8000-00000000000b';

const tenantClaims: SessionClaims = {
  sub: 'user-a',
  sessionId: 'session-a',
  audience: 'tenant',
  tenantId: tenantA,
  permissions: ['tenant.dashboard.view'],
};

describe('identity -> tenant -> permission -> audit slice', () => {
  let app: FastifyInstance;
  let audit: MemoryAuditWriter;
  let securityAudit: MemorySecurityAuditWriter;
  const now = new Date('2026-08-09T18:00:00.000Z');

  beforeEach(async () => {
    audit = new MemoryAuditWriter();
    securityAudit = new MemorySecurityAuditWriter();
    const sessions: SessionStatusReader = {
      isActive: async (sessionId) => sessionId !== 'revoked-session',
    };
    app = await buildApp(config, {
      audit,
      now: () => now,
      sessions,
      securityAudit,
      supportGrants: {
        readApproved: async (grantId, tenantId, requesterId, at) =>
          grantId === 'revoked-grant' || at >= new Date('2026-08-09T18:15:00.000Z')
            ? null
            : {
                id: grantId,
                tenantId,
                requesterId,
                ticketId: 'ticket-a',
                approverId: 'support-manager-a',
                reason: 'Investigate an approved billing display incident',
                permissions: ['tenant.dashboard.view'],
                expiresAt: '2026-08-09T18:15:00.000Z',
                authorizationVersion: 1,
              },
      },
    });
    await app.ready();
  });

  afterEach(async () => app.close());

  const tokenFor = (claims: SessionClaims) => app.jwt.sign(claims);

  it('returns a currency-separated tenant summary and writes audit evidence', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
      headers: { authorization: `Bearer ${tokenFor(tenantClaims)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenantId: tenantA,
      collections: { USD: 0, LBP: 0 },
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      tenantId: tenantA,
      actorId: 'user-a',
      action: 'tenant.summary.read',
      result: 'allowed',
    });
  });

  it('denies a verified user from another tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantB}/summary`,
      headers: { authorization: `Bearer ${tokenFor(tenantClaims)}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTHORIZATION_DENIED');
    expect(audit.events[0]).toMatchObject({
      result: 'denied',
      tenantId: tenantA,
      metadata: { requestedTenantId: tenantB },
    });
  });

  it('denies a tenant user without the explicit permission', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
      headers: {
        authorization: `Bearer ${tokenFor({ ...tenantClaims, permissions: [] })}`,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a revoked session even when its signed token has not expired', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
      headers: {
        authorization: `Bearer ${tokenFor({ ...tenantClaims, sessionId: 'revoked-session' })}`,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns 401 rather than 400 for a signed token with malformed claims', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'missing-session' })}` },
    });
    expect(response.statusCode).toBe(401);
    expect(securityAudit.events[0]).toMatchObject({
      action: 'session.validate',
      reason: 'invalid_or_revoked',
    });
  });

  it('immutably audits an unscoped platform attempt without writing into a tenant stream', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
      headers: {
        authorization: `Bearer ${tokenFor({
          sub: 'support-agent-a',
          sessionId: 'platform-session-a',
          audience: 'platform',
          permissions: ['platform.support.request'],
        })}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(audit.events).toHaveLength(0);
    expect(securityAudit.events[0]).toMatchObject({
      actorId: 'support-agent-a',
      claimedTenantId: tenantA,
      action: 'support.tenant.summary.read',
      reason: 'missing_scoped_grant',
    });
  });

  it('fails readiness closed when dependency probes are not configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });

  it('allows only an active scoped support grant and audits its grant id', async () => {
    const supportClaims: SessionClaims = {
      sub: 'support-agent-a',
      sessionId: 'platform-session-a',
      audience: 'platform',
      permissions: ['platform.support.request'],
      supportGrant: {
        grantId: 'grant-a',
        tenantId: tenantA,
        ticketId: 'ticket-a',
        approverId: 'support-manager-a',
        reason: 'Investigate an approved billing display incident',
        permissions: ['tenant.dashboard.view'],
        expiresAt: '2026-08-09T18:15:00.000Z',
        authorizationVersion: 1,
      },
    };

    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
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
      url: `/v1/tenants/${tenantA}/summary`,
      headers: {
        authorization: `Bearer ${tokenFor({
          sub: 'support-agent-a',
          sessionId: 'platform-session-a',
          audience: 'platform',
          permissions: [],
          supportGrant: {
            grantId: 'grant-a',
            tenantId: tenantA,
            ticketId: 'ticket-a',
            approverId: 'support-manager-a',
            reason: 'Investigate an approved billing display incident',
            permissions: ['tenant.dashboard.view'],
            expiresAt: '2026-08-09T17:59:59.000Z',
            authorizationVersion: 1,
          },
        })}`,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a support token whose authorization version no longer matches the grant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantA}/summary`,
      headers: {
        authorization: `Bearer ${tokenFor({
          sub: 'support-agent-a',
          sessionId: 'platform-session-a',
          audience: 'platform',
          permissions: ['platform.support.request'],
          supportGrant: {
            grantId: 'grant-a',
            tenantId: tenantA,
            ticketId: 'ticket-a',
            approverId: 'support-manager-a',
            reason: 'Investigate an approved billing display incident',
            permissions: ['tenant.dashboard.view'],
            expiresAt: '2026-08-09T18:15:00.000Z',
            authorizationVersion: 2,
          },
        })}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(securityAudit.events[0]).toMatchObject({
      actorId: 'support-agent-a',
      supportGrantId: 'grant-a',
      action: 'support.authentication.validate',
      reason: 'invalid_or_revoked',
    });
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
      url: `/v1/tenants/${tenantA}/summary`,
      headers: { authorization: `Bearer ${tokenFor(tenantClaims)}` },
    });

    expect(response.statusCode).toBe(500);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ result: 'failed' });
  });
});
