import type { SessionClaims, VerifiedTenantId } from '@isp/contracts';
import { IdempotencyConflictError } from '@isp/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { MemoryAuditWriter } from './audit.js';
import type { FinanceDocumentWrite, FinanceWriter } from './finance.js';

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
const invoiceId = '10000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-11T10:00:00.000Z');
const claims: SessionClaims = {
  sub: 'finance-user-a',
  sessionId: 'finance-session-a',
  audience: 'tenant',
  tenantId,
  authorizationVersion: 1,
  permissions: ['tenant.invoice.post', 'tenant.invoice.reverse', 'tenant.payment.post'],
};

describe('tenant finance API', () => {
  let app: FastifyInstance;
  let audit: MemoryAuditWriter;
  let finance: FinanceWriter;
  let postInvoiceMock: ReturnType<typeof vi.fn<FinanceWriter['postInvoice']>>;
  let activePermissions = claims.permissions;

  beforeEach(async () => {
    audit = new MemoryAuditWriter();
    activePermissions = claims.permissions;
    postInvoiceMock = vi.fn(
      async (verifiedTenantId: VerifiedTenantId, input: FinanceDocumentWrite) => ({
        id: invoiceId,
        tenantId: verifiedTenantId,
        entryKind: 'posted' as const,
        number: input.number,
        amountMinor: input.amountMinor,
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        postedAt: input.postedAt.toISOString(),
      }),
    );
    finance = {
      postInvoice: postInvoiceMock,
      reverseInvoice: vi.fn<FinanceWriter['reverseInvoice']>(),
      postPayment: vi.fn<FinanceWriter['postPayment']>(),
      reversePayment: vi.fn<FinanceWriter['reversePayment']>(),
      allocate: vi.fn<FinanceWriter['allocate']>(),
      reverseAllocation: vi.fn<FinanceWriter['reverseAllocation']>(),
    };
    app = await buildApp(config, {
      audit,
      finance,
      now: () => now,
      sessions: { isActive: async () => true },
      tenantMemberships: {
        readActive: async () => ({
          tenantId,
          userId: claims.sub,
          permissions: activePermissions,
          authorizationVersion: 1,
        }),
      },
    });
    await app.ready();
  }, 20_000);

  afterEach(async () => app.close());

  const token = () => app.jwt.sign(claims);

  it('posts a currency-explicit invoice while deferring allowed audit delivery to the outbox', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/invoices`,
      headers: {
        authorization: `Bearer ${token()}`,
        'idempotency-key': 'invoice-request-001',
      },
      payload: {
        number: 'INV-001',
        amountMinor: 100,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      tenantId,
      amountMinor: 100,
      currency: 'USD',
      idempotencyKey: 'invoice-request-001',
    });
    const tenantWrite = postInvoiceMock.mock.calls[0];
    expect(tenantWrite?.[0]).toBe(tenantId as VerifiedTenantId);
    expect(tenantWrite?.[1]).toMatchObject({ actorId: 'finance-user-a' });
    expect(tenantWrite?.[1].audit).toMatchObject({
      sessionId: 'finance-session-a',
      action: 'tenant.invoice.post',
      permission: 'tenant.invoice.post',
      reason: 'Authorized tenant finance mutation.',
    });
    expect(audit.events).toHaveLength(0);
  });

  it('passes the complete approved support-grant attribution to the atomic finance writer', async () => {
    await app.close();
    const supportClaims: SessionClaims = {
      sub: 'support-agent-a',
      sessionId: 'support-session-a',
      audience: 'platform',
      permissions: ['platform.support.request'],
      supportGrant: {
        grantId: 'support-grant-a',
        tenantId,
        ticketId: 'ticket-finance-a',
        approverId: 'support-manager-a',
        reason: 'Approved correction of the customer billing incident',
        permissions: ['tenant.invoice.post'],
        expiresAt: '2026-08-11T11:00:00.000Z',
        authorizationVersion: 1,
      },
    };
    app = await buildApp(config, {
      audit,
      finance,
      now: () => now,
      sessions: { isActive: async () => true },
      supportGrants: {
        readApproved: async () => ({
          id: 'support-grant-a',
          tenantId,
          requesterId: 'support-agent-a',
          ticketId: 'ticket-finance-a',
          approverId: 'support-manager-a',
          reason: 'Approved correction of the customer billing incident',
          permissions: ['tenant.invoice.post'],
          expiresAt: '2026-08-11T11:00:00.000Z',
          authorizationVersion: 1,
        }),
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/invoices`,
      headers: {
        authorization: `Bearer ${app.jwt.sign(supportClaims)}`,
        'idempotency-key': 'support-invoice-request-001',
        'user-agent': 'orvex-support-test/1.0',
      },
      payload: {
        number: 'SUPPORT-INV-001',
        amountMinor: 100,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });

    expect(response.statusCode).toBe(201);
    const supportWrite = postInvoiceMock.mock.calls.at(-1);
    expect(supportWrite?.[0]).toBe(tenantId as VerifiedTenantId);
    expect(supportWrite?.[1]).toMatchObject({ actorId: 'support-agent-a' });
    expect(supportWrite?.[1].audit).toMatchObject({
      sessionId: 'support-session-a',
      supportGrantId: 'support-grant-a',
      action: 'support.tenant.invoice.post',
      permission: 'tenant.invoice.post',
      reason: 'Approved correction of the customer billing incident',
      userAgent: 'orvex-support-test/1.0',
    });
  });

  it('rejects a finance mutation without an idempotency key before calling the writer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/invoices`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        number: 'INV-001',
        amountMinor: 100,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(postInvoiceMock).not.toHaveBeenCalled();
  });

  it('denies an unpermitted finance mutation and records the denial', async () => {
    activePermissions = [];
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/invoices`,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ ...claims, permissions: [] })}`,
        'idempotency-key': 'invoice-request-002',
      },
      payload: {
        number: 'INV-002',
        amountMinor: 100,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(postInvoiceMock).not.toHaveBeenCalled();
    expect(audit.events[0]).toMatchObject({ result: 'denied', tenantId });
  });

  it('returns a stable conflict response for an idempotency payload mismatch', async () => {
    postInvoiceMock.mockRejectedValueOnce(new IdempotencyConflictError());
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/finance/invoices`,
      headers: {
        authorization: `Bearer ${token()}`,
        'idempotency-key': 'invoice-request-003',
      },
      payload: {
        number: 'INV-003',
        amountMinor: 100,
        currency: 'USD',
        postedAt: now.toISOString(),
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(audit.events[0]).toMatchObject({ result: 'failed' });
  });

  it('publishes all six authenticated finance operations', () => {
    const paths = app.swagger().paths;
    expect(paths).toHaveProperty('/v1/tenants/{tenantId}/finance/invoices');
    expect(paths).toHaveProperty('/v1/tenants/{tenantId}/finance/invoices/{entryId}/reversal');
    expect(paths).toHaveProperty('/v1/tenants/{tenantId}/finance/payments');
    expect(paths).toHaveProperty('/v1/tenants/{tenantId}/finance/payments/{entryId}/reversal');
    expect(paths).toHaveProperty('/v1/tenants/{tenantId}/finance/allocations');
    expect(paths).toHaveProperty('/v1/tenants/{tenantId}/finance/allocations/{entryId}/reversal');
  });
});
