import type { SessionClaims } from '@isp/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { MemoryAuditWriter } from '../audit.js';

const config = {
  NODE_ENV: 'test' as const,
  HOST: '127.0.0.1',
  PORT: 3000,
  JWT_SECRET: 'test-only-secret-that-is-at-least-thirty-two-characters',
  SUPPORT_TOKEN_ISSUER: 'orvex-isp-test',
  SUPPORT_TOKEN_AUDIENCE: 'orvex-isp-api-test',
  AUTH_CONTROL_DATABASE_URL: 'postgres://test:test@localhost:5432/control_test',
  CONTROL_DATABASE_URL: 'postgres://test:test@localhost:5432/control_center_test',
  CONTROL_CONTEXT_KEY_ID: 'test-key-v1',
  CONTROL_CONTEXT_SECRET_BASE64: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  TENANT_DATABASE_URL: 'postgres://test:test@localhost:5432/tenant_test',
  OPERATIONS_CONTEXT_KEY_ID: 'test-operations-v1',
  OPERATIONS_CONTEXT_SECRET_BASE64: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  CORS_ORIGINS: 'http://localhost:5173',
};

const tenantId = '00000000-0000-4000-8000-00000000000a';
const memberId = '00000000-0000-4000-8000-000000000011';

describe('tenant staff directory route', () => {
  let app: FastifyInstance;
  let audit: MemoryAuditWriter;
  let claims: SessionClaims;

  beforeEach(async () => {
    audit = new MemoryAuditWriter();
    claims = {
      sub: 'staff-admin',
      sessionId: 'staff-session',
      audience: 'tenant',
      tenantId,
      authorizationVersion: 1,
      permissions: ['tenant.user.administer'],
    };
    app = await buildApp(config, {
      audit,
      sessions: { isActive: async () => true },
      tenantMemberships: {
        readActive: async () => ({
          tenantId,
          userId: claims.sub,
          permissions: claims.permissions,
          authorizationVersion: 1,
        }),
      },
      staff: {
        read: async () => [
          {
            id: memberId,
            email: 'collector@example.com',
            displayName: 'Field Collector',
            roleKey: 'collector',
            permissions: ['tenant.collection.view'],
            active: true,
            mfaRequired: true,
            disabled: false,
            authorizationVersion: 2,
            scope: { routeIds: ['route-a'] },
            createdAt: '2026-08-28T08:00:00.000Z',
          },
        ],
      },
    });
    await app.ready();
  });

  afterEach(async () => app.close());

  it('returns only access metadata and writes an allowed audit event', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/staff`,
      headers: { authorization: `Bearer ${app.jwt.sign(claims)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual({
      tenantId,
      members: [
        expect.objectContaining({
          id: memberId,
          email: 'collector@example.com',
          roleKey: 'collector',
          mfaRequired: true,
          scope: { routeIds: ['route-a'] },
        }),
      ],
    });
    expect(JSON.stringify(response.json())).not.toContain('password');
    expect(audit.events[0]).toMatchObject({
      action: 'tenant.staff.read',
      result: 'allowed',
      metadata: { permission: 'tenant.user.administer', memberCount: 1 },
    });
  });

  it('denies and audits a tenant user without staff administration permission', async () => {
    claims = { ...claims, permissions: ['tenant.dashboard.view'] };
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/staff`,
      headers: { authorization: `Bearer ${app.jwt.sign(claims)}` },
    });

    expect(response.statusCode).toBe(403);
    expect(audit.events[0]).toMatchObject({ action: 'tenant.staff.read', result: 'denied' });
  });
});
