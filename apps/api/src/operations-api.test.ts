import type { SessionClaims } from '@isp/contracts';
import { AuthorizationDeniedError } from '@isp/domain';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAuditWriter } from './audit.js';
import { MemorySecurityAuditWriter } from './security-audit.js';
import type { OperationsWriter } from './routes/operations/contracts.js';
import { registerTenantOperationsRoutes } from './routes/operations/tenant-operations.js';

const tenantId = '00000000-0000-4000-8000-00000000000a';
const otherTenantId = '00000000-0000-4000-8000-00000000000b';
const serviceId = '10000000-0000-4000-8000-000000000001';
const branchId = '20000000-0000-4000-8000-000000000001';
const areaId = '30000000-0000-4000-8000-000000000001';
const routeId = '40000000-0000-4000-8000-000000000001';
const claims: SessionClaims = {
  sub: 'operations-user-a',
  sessionId: 'operations-session-a',
  audience: 'tenant',
  tenantId,
  authorizationVersion: 1,
  branchIds: [branchId],
  areaIds: [areaId],
  routeIds: [routeId],
  permissions: [
    'tenant.subscriber.view',
    'tenant.subscriber.create',
    'tenant.invoice.create',
    'tenant.collection.reconcile',
    'tenant.network.job.create',
    'tenant.installation.manage',
    'tenant.sales.view',
    'tenant.sales.manage',
    'tenant.catalog.manage',
    'tenant.order.manage',
  ],
};

function writerMocks() {
  return {
    readSubscriberWorkspace: vi.fn(async () => ({ subscribers: [], services: [] })),
    readSalesWorkspace: vi.fn(async () => ({ leads: [], offers: [], quotes: [], orders: [] })),
    createSalesLead: vi.fn(async () => ({ id: 'lead-a' })),
    createSalesOfferVersion: vi.fn(async () => ({ id: 'offer-a' })),
    qualifySalesLead: vi.fn(async () => ({ id: 'qualification-a' })),
    createSalesQuote: vi.fn(async () => ({ id: 'quote-a' })),
    approveSalesQuote: vi.fn(async () => ({ id: 'quote-a', status: 'approved' })),
    acceptSalesQuote: vi.fn(async () => ({ id: 'order-a' })),
    convertSalesOrderSubscriber: vi.fn(async () => ({ id: 'subscriber-a' })),
    createCapacityResource: vi.fn(async () => ({ id: 'resource-a' })),
    reserveSalesOrderResource: vi.fn(async () => ({ id: 'reservation-a' })),
    createSalesOrderInstallation: vi.fn(async () => ({ id: 'installation-a' })),
    enqueueSalesOrderActivation: vi.fn(async () => ({ id: 'network-job-a' })),
    executeSalesOrderCommand: vi.fn(async () => ({ orderStatus: 'on_hold' })),
    postSalesOrderFirstInvoice: vi.fn(async () => ({ id: 'invoice-a' })),
    createSubscriber: vi.fn(async () => ({ id: 'subscriber-a' })),
    prepareBilling: vi.fn(async () => ({ id: 'run-a', status: 'succeeded' })),
    recordOfficePayment: vi.fn(async () => ({ id: 'payment-a' })),
    recordPaymentCorrection: vi.fn(async () => ({ id: 'correction-a' })),
    createPlanVersion: vi.fn(async () => ({ id: 'plan-version-a' })),
    createBillingPolicyVersion: vi.fn(async () => ({ id: 'billing-policy-a' })),
    createServiceInstallation: vi.fn(async () => ({ id: 'service-a' })),
    assignCollector: vi.fn(async () => ({ id: 'assignment-a' })),
    recordCollectorEvidence: vi.fn(async () => ({ id: 'evidence-a' })),
    reconcileCollector: vi.fn(async () => ({ id: 'reconciliation-a' })),
    transitionInstallation: vi.fn(async () => ({ id: 'installation-a' })),
    createIssue: vi.fn(async () => ({ id: 'issue-a' })),
    transitionIssue: vi.fn(async () => ({ id: 'issue-a' })),
    requestExport: vi.fn(async () => ({ id: 'export-a' })),
    configure: vi.fn(async () => ({ key: 'billing' })),
    enqueueNetworkAction: vi.fn(async () => ({ id: 'network-action-a' })),
  } satisfies OperationsWriter;
}

async function makeApp(activeClaims: SessionClaims, writer: OperationsWriter) {
  const app = Fastify({ logger: false });
  const audit = new MemoryAuditWriter();
  app.decorate('authenticate', async (request) => {
    request.auth = activeClaims;
  });
  registerTenantOperationsRoutes(app, {
    audit,
    securityAudit: new MemorySecurityAuditWriter(),
    writer,
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthorizationDeniedError) {
      return reply
        .code(403)
        .send({ error: { code: error.code, message: error.message, requestId: request.id } });
    }
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Request failed.', requestId: request.id },
    });
  });
  await app.ready();
  return { app, audit };
}

describe('tenant operations API route plugin', () => {
  let writer: ReturnType<typeof writerMocks>;

  beforeEach(() => {
    writer = writerMocks();
  });

  it('forwards the verified tenant, actor, and idempotency key for subscriber creation', async () => {
    const { app, audit } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/subscribers`,
      headers: { 'idempotency-key': 'subscriber-create-001' },
      payload: {
        subscriberNumber: 'SUB-1001',
        displayName: 'Maya Haddad',
        householdReference: 'HH-1001',
        householdName: 'Haddad household',
        locationLabel: 'Home',
        addressLine: 'Hamra, Beirut',
        branchId,
        areaId,
        routeId,
        primaryPhone: '+9611000000',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(writer.createSubscriber).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        actorId: claims.sub,
        idempotencyKey: 'subscriber-create-001',
        subscriberNumber: 'SUB-1001',
        branchIds: [branchId],
        auditAction: 'tenant.subscriber.create',
        permission: 'tenant.subscriber.create',
      }),
    );
    expect(audit.events).toHaveLength(0);
    await app.close();
  });

  it('reads the real sales workspace and requires recent MFA for quote approval', async () => {
    const { app } = await makeApp(claims, writer);
    const workspace = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/operations/sales/workspace`,
    });
    expect(workspace.statusCode).toBe(200);
    expect(writer.readSalesWorkspace).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.sales.view',
        auditAction: 'tenant.sales.workspace.read',
      }),
    );

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/quotes/approve`,
      headers: { 'idempotency-key': 'quote-approval-001' },
      payload: {
        quoteId: '80000000-0000-4000-8000-000000000001',
        reason: 'Commercial manager approved the controlled discount',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.approveSalesQuote).not.toHaveBeenCalled();
    await app.close();

    const withMfa = { ...claims, mfaVerifiedAt: '2026-08-11T11:55:00.000Z' };
    const { app: mfaApp } = await makeApp(withMfa, writer);
    const approved = await mfaApp.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/quotes/approve`,
      headers: { 'idempotency-key': 'quote-approval-001' },
      payload: {
        quoteId: '80000000-0000-4000-8000-000000000001',
        reason: 'Commercial manager approved the controlled discount',
      },
    });
    expect(approved.statusCode).toBe(201);
    expect(writer.approveSalesQuote).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ permission: 'tenant.catalog.manage' }),
    );
    await mfaApp.close();
  });

  it('reads the internal subscriber workspace with scoped view authority', async () => {
    const { app } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/operations/subscribers/workspace`,
    });
    expect(response.statusCode).toBe(200);
    expect(writer.readSubscriberWorkspace).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.subscriber.view',
        auditAction: 'tenant.subscriber.workspace.read',
        branchIds: [branchId],
        areaIds: [areaId],
        routeIds: [routeId],
      }),
    );
    await app.close();
  });

  it('requires subscriber-create and order-manage authority for order conversion', async () => {
    const payload = {
      orderId: '80000000-0000-4000-8000-000000000001',
      subscriberNumber: 'SUB-1001',
      householdReference: 'HH-1001',
      locationLabel: 'Primary service location',
      reason: 'Accepted order converted into the governed subscriber record',
    };
    const withoutOrderPermission = {
      ...claims,
      permissions: claims.permissions.filter((permission) => permission !== 'tenant.order.manage'),
    };
    const { app: deniedApp } = await makeApp(withoutOrderPermission, writer);
    const denied = await deniedApp.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/subscriber`,
      headers: { 'idempotency-key': 'order-subscriber-001' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.convertSalesOrderSubscriber).not.toHaveBeenCalled();
    await deniedApp.close();

    const { app } = await makeApp(claims, writer);
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/subscriber`,
      headers: { 'idempotency-key': 'order-subscriber-001' },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(writer.convertSalesOrderSubscriber).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        orderId: payload.orderId,
        permission: 'tenant.subscriber.create',
        auditAction: 'tenant.subscriber.create',
      }),
    );
    await app.close();
  });

  it('requires network execution and order authority for capacity reservation', async () => {
    const payload = {
      orderId: '80000000-0000-4000-8000-000000000001',
      resourceId: '90000000-0000-4000-8000-000000000001',
      units: 1,
      reason: 'Eligible capacity assigned to the accepted service order',
    };
    const withoutOrderPermission = {
      ...claims,
      permissions: claims.permissions.filter((permission) => permission !== 'tenant.order.manage'),
    };
    const { app: deniedApp } = await makeApp(withoutOrderPermission, writer);
    const denied = await deniedApp.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/resource`,
      headers: { 'idempotency-key': 'order-resource-001' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.reserveSalesOrderResource).not.toHaveBeenCalled();
    await deniedApp.close();

    const { app } = await makeApp(claims, writer);
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/resource`,
      headers: { 'idempotency-key': 'order-resource-001' },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(writer.reserveSalesOrderResource).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        orderId: payload.orderId,
        permission: 'tenant.network.job.create',
        auditAction: 'tenant.resource.reserve',
      }),
    );
    await app.close();
  });

  it('requires installation and order authority before opening field work', async () => {
    const payload = {
      orderId: '80000000-0000-4000-8000-000000000001',
      planId: '90000000-0000-4000-8000-000000000001',
      serviceNumber: 'SVC-SO-1001',
      billingAnchorDay: 1,
      reason: 'Field work opened after subscriber and capacity controls passed',
    };
    const withoutOrderPermission = {
      ...claims,
      permissions: claims.permissions.filter((permission) => permission !== 'tenant.order.manage'),
    };
    const { app: deniedApp } = await makeApp(withoutOrderPermission, writer);
    const denied = await deniedApp.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/installation`,
      headers: { 'idempotency-key': 'order-installation-001' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.createSalesOrderInstallation).not.toHaveBeenCalled();
    await deniedApp.close();

    const { app } = await makeApp(claims, writer);
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/installation`,
      headers: { 'idempotency-key': 'order-installation-001' },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(writer.createSalesOrderInstallation).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        orderId: payload.orderId,
        permission: 'tenant.installation.manage',
        auditAction: 'tenant.service.installation.create',
      }),
    );
    await app.close();
  });

  it('requires network execution and order authority before activation', async () => {
    const payload = {
      orderId: '80000000-0000-4000-8000-000000000001',
      reason: 'Verified installation queued for durable router activation',
    };
    const withoutOrderPermission = {
      ...claims,
      permissions: claims.permissions.filter((permission) => permission !== 'tenant.order.manage'),
    };
    const { app: deniedApp } = await makeApp(withoutOrderPermission, writer);
    const denied = await deniedApp.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/network`,
      headers: { 'idempotency-key': 'order-network-001' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.enqueueSalesOrderActivation).not.toHaveBeenCalled();
    await deniedApp.close();

    const { app } = await makeApp(claims, writer);
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/network`,
      headers: { 'idempotency-key': 'order-network-001' },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(writer.enqueueSalesOrderActivation).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        orderId: payload.orderId,
        permission: 'tenant.network.job.create',
        auditAction: 'tenant.network.job.create',
      }),
    );
    await app.close();
  });

  it('executes a governed order command with order authority', async () => {
    const { app } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/commands`,
      headers: { 'idempotency-key': 'order-hold-001' },
      payload: {
        orderId: '80000000-0000-4000-8000-000000000001',
        command: 'place_on_hold',
        reason: 'Customer requested a documented scheduling pause',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(writer.executeSalesOrderCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        command: 'place_on_hold',
        permission: 'tenant.order.manage',
        auditAction: 'tenant.order.command',
      }),
    );
    await app.close();
  });

  it('requires invoice post, invoice create, and order authority for first billing', async () => {
    const payload = {
      orderId: '80000000-0000-4000-8000-000000000001',
      documentNumber: 'INV-SO-1001-001',
      periodStart: '2026-08-11',
      periodEnd: '2026-09-11',
      reason: 'First service invoice posted after verified network activation',
    };
    const withoutCreatePermission = {
      ...claims,
      permissions: [
        ...claims.permissions.filter((permission) => permission !== 'tenant.invoice.create'),
        'tenant.invoice.post' as const,
      ],
    };
    const { app: deniedApp } = await makeApp(withoutCreatePermission, writer);
    const denied = await deniedApp.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/billing`,
      headers: { 'idempotency-key': 'order-billing-001' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.postSalesOrderFirstInvoice).not.toHaveBeenCalled();
    await deniedApp.close();

    const billingClaims = {
      ...claims,
      permissions: [...claims.permissions, 'tenant.invoice.post' as const],
    };
    const { app } = await makeApp(billingClaims, writer);
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/sales/orders/billing`,
      headers: { 'idempotency-key': 'order-billing-001' },
      payload,
    });
    expect(allowed.statusCode).toBe(201);
    expect(writer.postSalesOrderFirstInvoice).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        orderId: payload.orderId,
        permission: 'tenant.invoice.post',
        auditAction: 'tenant.order.first_invoice.post',
      }),
    );
    await app.close();
  });

  it('denies a cross-tenant mutation before invoking the writer', async () => {
    const { app, audit } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${otherTenantId}/operations/billing-runs`,
      headers: { 'idempotency-key': 'billing-run-001' },
      payload: { periodStart: '2026-08-01', periodEnd: '2026-09-01' },
    });

    expect(response.statusCode).toBe(403);
    expect(writer.prepareBilling).not.toHaveBeenCalled();
    expect(audit.events.at(-1)).toMatchObject({
      result: 'denied',
      tenantId,
      resourceId: otherTenantId,
    });
    await app.close();
  });

  it('denies a missing focused permission', async () => {
    const { app } = await makeApp({ ...claims, permissions: [] }, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/exports`,
      headers: { 'idempotency-key': 'report-export-001' },
      payload: { reportKey: 'subscriber-aging', format: 'csv', filters: {} },
    });

    expect(response.statusCode).toBe(403);
    expect(writer.requestExport).not.toHaveBeenCalled();
    await app.close();
  });

  it('exposes no platform-state action and delegates only an explicit subscriber service action', async () => {
    const { app } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/network-actions`,
      headers: { 'idempotency-key': 'network-action-001' },
      payload: { serviceId, action: 'change_profile', payload: { profileReference: '20M' } },
    });

    expect(response.statusCode).toBe(201);
    expect(writer.enqueueNetworkAction).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ serviceId, action: 'change_profile' }),
    );
    expect(response.body).not.toContain('platformSubscription');
    await app.close();
  });

  it('rejects caller-controlled VAT and reconciliation totals', async () => {
    const { app } = await makeApp(claims, writer);
    const billing = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/billing-runs`,
      headers: { 'idempotency-key': 'billing-rate-001' },
      payload: { periodStart: '2026-08-01', periodEnd: '2026-09-01', vatRateBasisPoints: 1100 },
    });
    expect(billing.statusCode).toBe(500);
    expect(writer.prepareBilling).not.toHaveBeenCalled();
    const reconciliation = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/collector-reconciliations`,
      headers: { 'idempotency-key': 'collector-total-001' },
      payload: {
        collectorUserId: '50000000-0000-4000-8000-000000000001',
        routeId,
        businessDate: '2026-08-11',
        currency: 'USD',
        expectedMinor: 100,
        declaredMinor: 100,
      },
    });
    expect(reconciliation.statusCode).toBe(500);
    expect(writer.reconcileCollector).not.toHaveBeenCalled();
    await app.close();
  });

  it('denies a selected route outside the signed session scope', async () => {
    const { app } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/collector-assignments`,
      headers: { 'idempotency-key': 'assignment-scope-001' },
      payload: {
        collectorUserId: '50000000-0000-4000-8000-000000000001',
        subscriberId: '60000000-0000-4000-8000-000000000001',
        routeId: '40000000-0000-4000-8000-000000000099',
        financeInvoiceId: '70000000-0000-4000-8000-000000000001',
        dueOn: '2026-08-12',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(writer.assignCollector).not.toHaveBeenCalled();
    await app.close();
  });
});
