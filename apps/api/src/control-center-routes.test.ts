import type { SessionClaims } from '@isp/contracts';
import { AuthorizationDeniedError } from '@isp/domain';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  registerControlCenterRoutes,
  type ControlCenterApiService,
} from './routes/control-center/index.js';
const tenantId = '00000000-0000-4000-8000-000000000042';
const approvalRequestId = '00000000-0000-4000-8000-000000000043';
const now = new Date('2026-08-11T12:00:00.000Z');
const claims: SessionClaims = {
  sub: 'platform-user-a',
  sessionId: 'platform-session-a',
  audience: 'platform',
  mfaVerifiedAt: '2026-08-11T11:55:00.000Z',
  permissions: [
    'platform.client.view',
    'platform.client.manage',
    'platform.subscription.manage',
    'platform.billing.post',
    'platform.payment.post',
  ],
};
describe('Control Center API routes', () => {
  let activeClaims = claims;
  let service: ControlCenterApiService;
  let listClients: ReturnType<typeof vi.fn<ControlCenterApiService['listClients']>>;
  let transitionSubscription: ReturnType<
    typeof vi.fn<ControlCenterApiService['transitionSubscription']>
  >;
  let approveTransition: ReturnType<typeof vi.fn<ControlCenterApiService['approveTransition']>>;
  let postInvoice: ReturnType<typeof vi.fn<ControlCenterApiService['postInvoice']>>;
  beforeEach(() => {
    activeClaims = claims;
    listClients = vi.fn(async () => ({ items: [] }));
    transitionSubscription = vi.fn(async () => ({
      approvalRequestId,
      state: 'active',
      status: 'pending',
    }));
    approveTransition = vi.fn(async () => ({
      transitionId: 'transition-a',
      state: 'restricted',
      status: 'executed',
    }));
    postInvoice = vi.fn(async () => ({ id: 'invoice-a' }));
    service = {
      listClients,
      createClient: vi.fn(async () => ({ id: 'client-a' })),
      createContact: vi.fn(async () => ({ id: 'contact-a' })),
      createPackageVersion: vi.fn(async () => ({ id: 'package-v1' })),
      assignSubscription: vi.fn(async () => ({ id: 'subscription-a' })),
      transitionSubscription,
      approveTransition,
      postInvoice,
      postPayment: vi.fn(async () => ({ id: 'payment-a' })),
      reverseInvoice: vi.fn(async () => ({ id: 'invoice-reversal' })),
      reversePayment: vi.fn(async () => ({ id: 'payment-reversal' })),
      allocatePayment: vi.fn(async () => ({ id: 'allocation-a' })),
      reverseAllocation: vi.fn(async () => ({ id: 'allocation-reversal' })),
      readIntegrations: vi.fn(async () => ({
        settings: [],
        recentEvents: [],
        recentDeliveries: [],
      })),
      configureIntegration: vi.fn(async () => ({ kind: 'smtp', version: 1, replay: false })),
      testIntegration: vi.fn(async () => ({ kind: 'smtp', version: 1, status: 'passed' })),
    };
  });
  async function build() {
    const app = Fastify();
    app.decorateRequest('auth');
    app.decorate('authenticate', async (request: Parameters<typeof app.authenticate>[0]) => {
      request.auth = activeClaims;
    });
    registerControlCenterRoutes(app, { service, now: () => now });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'VALIDATION_FAILED' });
      if (error instanceof AuthorizationDeniedError)
        return reply.code(403).send({ code: error.code });
      const d = typeof error === 'object' && error !== null ? error : {};
      const status = 'statusCode' in d ? Number(d.statusCode) : 500;
      return reply.code(status).send({ code: 'code' in d ? d.code : 'INTERNAL_ERROR' });
    });
    await app.ready();
    return app;
  }
  it('binds list access to verified platform request context', async () => {
    const app = await build();
    expect(
      (await app.inject({ method: 'GET', url: '/v1/control-center/clients?state=active&limit=25' }))
        .statusCode,
    ).toBe(200);
    expect(listClients).toHaveBeenCalledWith(
      expect.objectContaining({ states: ['active'], limit: 25 }),
      expect.objectContaining({
        actorId: 'platform-user-a',
        sessionId: 'platform-session-a',
        permission: 'platform.client.view',
      }),
    );
    await app.close();
  });
  it('denies missing permission', async () => {
    activeClaims = { ...claims, permissions: [] };
    const app = await build();
    expect(
      (await app.inject({ method: 'GET', url: '/v1/control-center/clients' })).statusCode,
    ).toBe(403);
    expect(listClients).not.toHaveBeenCalled();
    await app.close();
  });
  it('rejects caller controlled postedAt', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/control-center/clients/${tenantId}/billing/invoices`,
      headers: { 'idempotency-key': 'platform-invoice-100' },
      payload: {
        number: 'PLAT-100',
        amountMinor: 10000,
        currency: 'USD',
        dueAt: '2026-09-01T00:00:00Z',
        reason: 'August platform service',
        postedAt: now.toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(postInvoice).not.toHaveBeenCalled();
    await app.close();
  });
  it('binds a valid document to authenticated audit context and server time', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/control-center/clients/${tenantId}/billing/invoices`,
      headers: { 'idempotency-key': 'platform-invoice-101', 'user-agent': 'orvex-test/1' },
      payload: {
        number: 'PLAT-101',
        amountMinor: 10000,
        currency: 'USD',
        dueAt: '2026-09-01T00:00:00Z',
        reason: 'August platform service',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(postInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'platform-user-a',
        sessionId: 'platform-session-a',
        permission: 'platform.billing.post',
        userAgent: 'orvex-test/1',
        receivedAt: now.toISOString(),
      }),
    );
    expect(postInvoice.mock.calls[0]?.[0]).not.toHaveProperty('postedAt');
    await app.close();
  });
  it('requests a restriction without accepting an approver and does not execute it', async () => {
    const app = await build();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/control-center/clients/${tenantId}/subscription/transitions`,
      headers: { 'idempotency-key': 'restrict-client-001' },
      payload: {
        expectedState: 'active',
        expectedRevision: 7,
        toState: 'restricted',
        reason: 'Platform account review required',
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      status: 'pending',
      state: 'active',
      subscriberNetworkCommands: [],
    });
    expect(transitionSubscription.mock.calls[0]?.[0]).not.toHaveProperty('approverId');
    await app.close();
  });
  it('requires a different fresh-MFA authenticated request to approve', async () => {
    activeClaims = { ...claims, sub: 'platform-manager-b' };
    const app = await build();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/control-center/subscription/transition-requests/${approvalRequestId}/approve`,
      headers: { 'idempotency-key': 'approve-client-001' },
      payload: { reason: 'Reviewed account evidence' },
    });
    expect(response.statusCode).toBe(201);
    expect(approveTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'platform-manager-b',
        sessionId: 'platform-session-a',
        approvalRequestId,
      }),
    );
    await app.close();
  });
  it('denies approval when MFA is stale', async () => {
    activeClaims = {
      ...claims,
      sub: 'platform-manager-b',
      mfaVerifiedAt: '2026-08-11T11:40:00.000Z',
    };
    const app = await build();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/control-center/subscription/transition-requests/${approvalRequestId}/approve`,
          headers: { 'idempotency-key': 'approve-client-002' },
          payload: { reason: 'Reviewed account evidence' },
        })
      ).statusCode,
    ).toBe(403);
    expect(approveTransition).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('Control Center integration routes', () => {
  const integrationClaims: SessionClaims = {
    ...claims,
    permissions: ['platform.integration.manage'],
  };
  type ServiceMocks = {
    [K in keyof ControlCenterApiService]: ReturnType<typeof vi.fn<ControlCenterApiService[K]>>;
  };
  function integrationService(): ServiceMocks {
    return {
      listClients: vi.fn(async () => []),
      createClient: vi.fn(),
      createContact: vi.fn(),
      createPackageVersion: vi.fn(),
      assignSubscription: vi.fn(),
      transitionSubscription: vi.fn(),
      approveTransition: vi.fn(),
      postInvoice: vi.fn(),
      postPayment: vi.fn(),
      reverseInvoice: vi.fn(),
      reversePayment: vi.fn(),
      allocatePayment: vi.fn(),
      reverseAllocation: vi.fn(),
      readIntegrations: vi.fn(async () => ({
        settings: [],
        recentEvents: [],
        recentDeliveries: [],
      })),
      configureIntegration: vi.fn(async () => ({ kind: 'smtp', version: 1, replay: false })),
      testIntegration: vi.fn(async () => ({ kind: 'smtp', version: 1, status: 'passed' })),
    };
  }
  async function buildWith(activeClaims: SessionClaims, target: ControlCenterApiService) {
    const app = Fastify();
    app.decorateRequest('auth');
    app.decorate('authenticate', async (request: Parameters<typeof app.authenticate>[0]) => {
      request.auth = activeClaims;
    });
    registerControlCenterRoutes(app, { service: target, now: () => now });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ZodError) return reply.code(400).send({ code: 'VALIDATION_FAILED' });
      if (error instanceof AuthorizationDeniedError)
        return reply.code(403).send({ code: error.code });
      return reply.code(500).send({ code: 'INTERNAL_ERROR' });
    });
    await app.ready();
    return app;
  }
  const smtpBody = {
    config: {
      host: 'smtp.example.test',
      port: 587,
      security: 'starttls',
      username: 'mailer',
      fromAddress: 'noreply@example.test',
    },
    secrets: { password: 'mail-password' },
    keepSecrets: false,
    active: true,
    reason: 'Configure platform verification mail',
  };

  it('requires the integration permission for reads and writes', async () => {
    const target = integrationService();
    const app = await buildWith(claims, target);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/control-center/integrations' })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/control-center/integrations/smtp',
          headers: { 'idempotency-key': 'integration-smtp-001' },
          payload: smtpBody,
        })
      ).statusCode,
    ).toBe(403);
    expect(target.configureIntegration).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps secrets out of the hashed envelope but hands them to the service', async () => {
    const target = integrationService();
    const app = await buildWith(integrationClaims, target);
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/control-center/integrations/smtp',
      headers: { 'idempotency-key': 'integration-smtp-002' },
      payload: smtpBody,
    });
    expect(response.statusCode).toBe(200);
    const [input] = vi.mocked(target.configureIntegration).mock.calls[0] ?? [];
    expect(input).toMatchObject({
      kind: 'smtp',
      permission: 'platform.integration.manage',
      action: 'integration.configure',
      secrets: { password: 'mail-password' },
      idempotencyKey: 'integration-smtp-002',
    });
    const withoutSecret = await app.inject({
      method: 'PUT',
      url: '/v1/control-center/integrations/smtp',
      headers: { 'idempotency-key': 'integration-smtp-003' },
      payload: { ...smtpBody, secrets: undefined, keepSecrets: true },
    });
    expect(withoutSecret.statusCode).toBe(200);
    const [second] = vi.mocked(target.configureIntegration).mock.calls[1] ?? [];
    // The request hash covers everything except the credential itself.
    expect(second?.requestHash).not.toBe(input?.requestHash);
    expect(second?.secrets).toBeUndefined();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/control-center/integrations/smtp',
          headers: { 'idempotency-key': 'integration-smtp-004' },
          payload: { ...smtpBody, config: { ...smtpBody.config, password: 'inline' } },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('records provider tests through the signed test action', async () => {
    const target = integrationService();
    const app = await buildWith(integrationClaims, target);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/control-center/integrations/smtp/tests',
      headers: { 'idempotency-key': 'integration-test-001' },
      payload: { recipient: 'ops@example.test', reason: 'Verify SMTP after rotation' },
    });
    expect(response.statusCode).toBe(201);
    expect(target.testIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smtp',
        recipient: 'ops@example.test',
        action: 'integration.test',
      }),
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/control-center/integrations/pager/tests',
          headers: { 'idempotency-key': 'integration-test-002' },
          payload: { recipient: 'ops@example.test', reason: 'Verify SMTP after rotation' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
