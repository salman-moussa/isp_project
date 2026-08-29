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
  const now = new Date('2026-08-29T08:00:00.000Z');

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
      now: () => now,
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
        readInvitations: async () => [],
        invite: async () => ({
          invitationId: '00000000-0000-4000-8000-000000000099',
          status: 'pending',
          expiresAt: '2026-08-30T08:00:00.000Z',
          replayed: false,
        }),
        accept: async () => ({ outcome: 'created', tenantId, userId: memberId }),
        updateMembership: async () => 3,
        revokeInvitation: async () => true,
      },
      staffScopes: {
        read: async () => ({
          branches: [],
          areas: [],
          routes: [
            {
              id: '00000000-0000-4000-8000-000000000099',
              code: 'R-01',
              nameEn: 'Route 01',
              nameAr: 'المسار 01',
            },
          ],
        }),
        assertValid: async () => undefined,
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
      invitations: [],
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

  it('requires recent MFA before creating an invitation', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/staff/invitations`,
      headers: {
        authorization: `Bearer ${app.jwt.sign(claims)}`,
        'idempotency-key': 'invite-collector-1',
      },
      payload: {
        email: 'collector@example.com',
        displayName: 'Field Collector',
        roleKey: 'isp_administrator',
        scope: {},
        reason: 'Approved operations administrator onboarding',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(audit.events[0]).toMatchObject({
      action: 'tenant.staff.invitation.create',
      result: 'denied',
    });

    claims = { ...claims, mfaVerifiedAt: now.toISOString() };
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/staff/invitations`,
      headers: {
        authorization: `Bearer ${app.jwt.sign(claims)}`,
        'idempotency-key': 'invite-collector-2',
      },
      payload: {
        email: 'admin2@example.com',
        displayName: 'Second Administrator',
        roleKey: 'isp_administrator',
        scope: {},
        reason: 'Approved operations administrator onboarding',
      },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toMatchObject({ status: 'pending', replayed: false });
  });

  it('reads governed scopes and revokes a pending invitation after recent MFA', async () => {
    claims = { ...claims, mfaVerifiedAt: now.toISOString() };
    const authorization = `Bearer ${app.jwt.sign(claims)}`;
    const scopes = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/staff/scopes`,
      headers: { authorization },
    });
    expect(scopes.statusCode).toBe(200);
    expect(scopes.json().routes[0]).toMatchObject({ code: 'R-01' });

    const revoked = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/staff/invitations/00000000-0000-4000-8000-000000000099/revoke`,
      headers: { authorization },
      payload: { reason: 'Invitation was sent to the wrong address' },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ revoked: true });
  });
});
