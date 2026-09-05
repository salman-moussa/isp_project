import type { SessionClaims } from '@isp/contracts';
import { AuthorizationDeniedError } from '@isp/domain';
import Fastify from 'fastify';
import { ZodError } from 'zod';
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
const itemId = '60000000-0000-4000-8000-000000000009';
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
    'tenant.subscriber.edit',
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
    readNocWorkspace: vi.fn(async () => ({
      incidents: [],
      routes: [],
      services: [],
      page: 1,
      pageSize: 25,
      totalCount: 0,
      serviceDirectoryTruncated: false,
    })),
    createOutageIncident: vi.fn(async () => ({
      id: serviceId,
      status: 'investigating',
      version: 1,
    })),
    transitionOutageIncident: vi.fn(async () => ({
      id: serviceId,
      status: 'identified',
      version: 2,
    })),
    postCustomerAccountEntry: vi.fn(async () => ({ id: serviceId })),
    readCustomerAccounts: vi.fn(async () => ({ subscribers: [], invoices: [], entries: [] })),
    generateInvoiceDocument: vi.fn(async () => ({ id: serviceId, status: 'ready' })),
    downloadInvoiceDocument: vi.fn(async () => ({
      bytes: Buffer.from('%PDF-test'),
      filename: 'invoice.pdf',
    })),
    readBillingWorkspace: vi.fn(async () => ({ runs: [], dunningPolicies: [], dunningCases: [] })),
    readSubscriberWorkspace: vi.fn(async () => ({ subscribers: [], services: [] })),
    readSalesWorkspace: vi.fn(async () => ({ leads: [], offers: [], quotes: [], orders: [] })),
    applyServiceChangeOrder: vi.fn(async () => ({ id: 'change-order-a' })),
    createAddonVersion: vi.fn(async () => ({ id: 'addon-version-a' })),
    purchaseServiceAddon: vi.fn(async () => ({ id: 'addon-purchase-a' })),
    recordServiceUsage: vi.fn(async () => ({ id: 'usage-event-a' })),
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
    createDunningPolicyVersion: vi.fn(async () => ({ id: 'dunning-policy-a' })),
    evaluateDunning: vi.fn(async () => ({ id: 'dunning-run-a', status: 'succeeded' })),
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
    readChartOfAccounts: vi.fn(async () => []),
    postJournalEntry: vi.fn(async () => ({ id: 'entry-a', entryNumber: 'JE-001' })),
    readJournalEntries: vi.fn(async () => []),
    readCustomerStatement: vi.fn(async () => ({ entries: [] })),
    readTrialBalance: vi.fn(async () => ({ accounts: [] })),
    readAccountingPeriods: vi.fn(async () => []),
    closeAccountingPeriod: vi.fn(async () => ({ id: 'period-a', status: 'soft_closed' })),
    readDealers: vi.fn(async () => []),
    generateVoucherBatch: vi.fn(async () => ({ batchId: 'batch-a', count: 10 })),
    redeemVoucher: vi.fn(async () => ({ voucherId: 'voucher-a', status: 'redeemed' })),
    readWarehouses: vi.fn(async () => []),
    readInventoryItems: vi.fn(async () => []),
    readSerializedAssets: vi.fn(async () => []),
    readWarehouseWorkspace: vi.fn(async () => ({
      warehouses: [],
      items: [],
      assets: [],
      installations: [],
      vendors: [],
      purchaseOrders: [],
    })),
    transitionInventoryCustody: vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'issued',
      version: 2,
    })),
    executeProcurementCommand: vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'draft',
      version: 1,
    })),
    executeWarehouseAdminCommand: vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'active',
      version: 1,
    })),
    executeStockCommand: vi.fn(async () => ({
      action: 'transfer_stock',
      quantity: 5,
      fromQuantityOnHand: 5,
      toQuantityOnHand: 5,
    })),
    executeStockReservationCommand: vi.fn(async () => ({
      action: 'reserve_stock',
      reservationId: '11111111-1111-4111-8111-111111111111',
      status: 'held',
      version: 1,
    })),
    executeRmaCommand: vi.fn(async () => ({
      action: 'open_case',
      caseId: '11111111-1111-4111-8111-111111111111',
      status: 'open',
      version: 1,
    })),
    executeVendorQuoteCommand: vi.fn(async () => ({
      action: 'create_quote_request',
      requestId: '11111111-1111-4111-8111-111111111111',
      status: 'open',
      version: 1,
    })),
    executeStockCountCommand: vi.fn(async () => ({
      action: 'open_count',
      countId: '11111111-1111-4111-8111-111111111111',
      status: 'open',
      version: 1,
      lines: 3,
    })),
    readNasClients: vi.fn(async () => []),
    readRadiusSessions: vi.fn(async () => []),
    readIpPools: vi.fn(async () => []),
    readCpeDevices: vi.fn(async () => []),
    readNetworkAlarms: vi.fn(async () => []),
    readOutages: vi.fn(async () => []),
    readQosReports: vi.fn(async () => []),
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
  // Mirrors the production handler in app.ts so contract violations surface as 400 here too;
  // otherwise every rejected payload would look like a server fault in these tests.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthorizationDeniedError) {
      return reply
        .code(403)
        .send({ error: { code: error.code, message: error.message, requestId: request.id } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request did not match the expected contract.',
          requestId: request.id,
        },
      });
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

  it('serializes real accounting arrays and registers periods', async () => {
    const { app } = await makeApp({ ...claims, permissions: ['tenant.accounting.view'] }, writer);
    for (const name of ['chart-of-accounts', 'journal-entries', 'periods']) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/tenants/${tenantId}/accounting/${name}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    await app.close();
    const nonempty = await makeApp(
      { ...claims, permissions: ['tenant.accounting.view'] },
      { ...writer, readChartOfAccounts: async () => [{ id: serviceId, accountCode: '1010' }] },
    );
    expect(
      (
        await nonempty.app.inject({
          method: 'GET',
          url: `/v1/tenants/${tenantId}/accounting/chart-of-accounts`,
        })
      ).json(),
    ).toEqual([{ id: serviceId, accountCode: '1010' }]);
    await nonempty.app.close();
  });

  it('forwards accounting dates and statement pagination from validated queries', async () => {
    const { app } = await makeApp({ ...claims, permissions: ['tenant.accounting.view'] }, writer);
    const balance = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/accounting/trial-balance?asOfDate=2026-08-01`,
    });
    expect(balance.statusCode).toBe(200);
    expect(writer.readTrialBalance).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ asOfDate: '2026-08-01' }),
    );
    const statement = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/accounting/customer-statement?subscriberId=${serviceId}&currency=LBP&startDate=2026-01-01&endDate=2026-08-01&page=2&pageSize=10`,
    });
    expect(statement.statusCode).toBe(200);
    expect(writer.readCustomerStatement).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.accounting.view',
        auditAction: 'tenant.accounting.statement.read',
        query: {
          subscriberId: serviceId,
          currency: 'LBP',
          startDate: '2026-01-01',
          endDate: '2026-08-01',
          page: 2,
          pageSize: 10,
        },
      }),
    );
    await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/accounting/trial-balance?asOfDate=2026-02-30`,
    });
    expect(writer.readTrialBalance).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('denies accounting reads without permission and across tenants', async () => {
    const denied = await makeApp(claims, writer);
    expect(
      (
        await denied.app.inject({
          method: 'GET',
          url: `/v1/tenants/${tenantId}/accounting/periods`,
        })
      ).statusCode,
    ).toBe(403);
    await denied.app.close();
    const { app } = await makeApp({ ...claims, permissions: ['tenant.accounting.view'] }, writer);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/tenants/${otherTenantId}/accounting/chart-of-accounts`,
        })
      ).statusCode,
    ).toBe(403);
    expect(writer.readChartOfAccounts).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires recent MFA and the correct permission for manual journals', async () => {
    const command = {
      entryNumber: 'MAN-001',
      entryDate: '2026-08-11',
      descriptionEn: 'Manual accounting entry',
      descriptionAr: 'قيد محاسبة يدوي موثق',
      sourceType: 'manual',
      lines: [
        { accountId: serviceId, debitMinor: 100, creditMinor: 0, currency: 'USD' },
        { accountId: branchId, debitMinor: 0, creditMinor: 100, currency: 'USD' },
      ],
    };
    const payload = { command };
    const url = `/v1/tenants/${tenantId}/operations/accounting/journals`;
    const headers = { 'idempotency-key': 'accounting-manual-001' };
    const denied = await makeApp({ ...claims, permissions: ['tenant.accounting.post'] }, writer);
    expect((await denied.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(
      403,
    );
    expect(writer.postJournalEntry).not.toHaveBeenCalled();
    await denied.app.close();
    const { app } = await makeApp(
      {
        ...claims,
        permissions: ['tenant.accounting.post'],
        mfaVerifiedAt: '2026-08-11T11:59:00.000Z',
      },
      writer,
    );
    const response = await app.inject({ method: 'POST', url, headers, payload });
    expect(response.statusCode).toBe(201);
    expect(writer.postJournalEntry).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        command,
        idempotencyKey: 'accounting-manual-001',
        auditAction: 'tenant.accounting.journal.post',
      }),
    );
    await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { command: { ...command, sourceType: 'invoice' } },
    });
    expect(writer.postJournalEntry).toHaveBeenCalledTimes(1);
    await app.close();
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

  it('applies a reasoned service change order under subscriber and order permissions', async () => {
    const { app } = await makeApp(claims, writer);
    const targetPlanId = '50000000-0000-4000-8000-000000000001';
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/services/change-orders`,
      headers: { 'idempotency-key': 'service-change-001' },
      payload: {
        serviceId,
        action: 'plan_change',
        targetPlanId,
        reason: 'Customer approved the upgraded plan.',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(writer.applyServiceChangeOrder).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        serviceId,
        action: 'plan_change',
        targetPlanId,
        permission: 'tenant.subscriber.edit',
        auditAction: 'tenant.service.change.apply',
      }),
    );
    await app.close();
  });

  it('governs add-on publication, purchase, and usage ingestion with focused permissions', async () => {
    const { app } = await makeApp(claims, writer);
    const addonVersionId = '50000000-0000-4000-8000-000000000005';
    const published = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/addon-versions`,
      headers: { 'idempotency-key': 'addon-version-001' },
      payload: {
        branchId,
        code: 'TOPUP-100',
        version: 1,
        nameEn: '100 GB top-up',
        nameAr: 'إضافة ١٠٠ جيجابايت',
        kind: 'quota_topup',
        amountMinor: 500,
        currency: 'USD',
        quotaGb: 100,
        effectiveFrom: '2026-09-01',
        reason: 'Approved quota top-up catalogue publication.',
      },
    });
    expect(published.statusCode).toBe(201);
    expect(writer.createAddonVersion).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ permission: 'tenant.invoice.create', code: 'TOPUP-100' }),
    );
    const purchased = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/services/addons`,
      headers: { 'idempotency-key': 'addon-purchase-001' },
      payload: {
        serviceId,
        addonVersionId,
        quantity: 1,
        appliesFrom: '2026-09-01',
        appliesTo: '2026-10-01',
        reason: 'Subscriber approved the quota top-up purchase.',
      },
    });
    expect(purchased.statusCode).toBe(201);
    expect(writer.purchaseServiceAddon).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.subscriber.edit',
        auditAction: 'tenant.service.addon.purchase',
      }),
    );
    const usage = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/usage-events`,
      headers: { 'idempotency-key': 'usage-event-001' },
      payload: {
        serviceId,
        source: 'radius',
        eventReference: 'acct-session-001',
        occurredAt: '2026-09-12T10:00:00.000Z',
        downloadBytes: 1_100_000_000,
        uploadBytes: 100_000_000,
        reason: 'Authorized RADIUS accounting mediation event.',
      },
    });
    expect(usage.statusCode).toBe(201);
    expect(writer.recordServiceUsage).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ permission: 'tenant.invoice.create', source: 'radius' }),
    );
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
    // A caller-supplied VAT rate is not part of the contract, so the request is rejected as a
    // contract violation before any billing work is attempted.
    expect(billing.statusCode).toBe(400);
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
    expect(reconciliation.statusCode).toBe(400);
    expect(writer.reconcileCollector).not.toHaveBeenCalled();
    await app.close();
  });

  it('reads billing recovery and governs failed-only retry and dunning evaluation', async () => {
    const { app } = await makeApp(claims, writer);
    const workspace = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/operations/billing/workspace`,
    });
    expect(workspace.statusCode).toBe(200);
    expect(writer.readBillingWorkspace).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ permission: 'tenant.invoice.create' }),
    );

    const sourceRunId = '90000000-0000-4000-8000-000000000001';
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/billing-runs`,
      headers: { 'idempotency-key': 'billing-retry-001' },
      payload: {
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
        retryOfRunId: sourceRunId,
        reason: 'Retry only services with corrected billing policy coverage.',
      },
    });
    expect(retry.statusCode).toBe(201);
    expect(writer.prepareBilling).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ retryOfRunId: sourceRunId }),
    );

    const policy = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/dunning-policy-versions`,
      headers: { 'idempotency-key': 'dunning-policy-001' },
      payload: {
        version: 1,
        paymentTermsDays: 10,
        reminderAfterDays: 2,
        finalNoticeAfterDays: 7,
        suspensionReviewAfterDays: 14,
        effectiveFrom: '2026-08-01',
        reason: 'Owner approved staged collection review thresholds.',
      },
    });
    expect(policy.statusCode).toBe(201);
    expect(writer.createDunningPolicyVersion).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ suspensionReviewAfterDays: 14 }),
    );

    const evaluation = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/dunning-evaluations`,
      headers: { 'idempotency-key': 'dunning-evaluation-001' },
      payload: {
        asOfDate: '2026-09-02',
        reason: 'Evaluate overdue balances without automatic network suspension.',
      },
    });
    expect(evaluation.statusCode).toBe(201);
    expect(writer.evaluateDunning).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ asOfDate: '2026-09-02' }),
    );
    await app.close();
  });

  it('publishes an owner-confirmed legal invoice policy without implicit currency conversion', async () => {
    const { app } = await makeApp(claims, writer);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/billing-policy-versions`,
      headers: { 'idempotency-key': 'legal-policy-001' },
      payload: {
        branchId,
        version: 2,
        vatRateBasisPoints: 1100,
        taxTreatment: 'taxable',
        roundingMode: 'half_up',
        supplierNameEn: 'Cedar Net SAL',
        supplierNameAr: 'شركة سيدر نت ش.م.ل.',
        supplierAddressEn: 'Beirut, Lebanon',
        supplierAddressAr: 'بيروت، لبنان',
        supplierTaxRegistrationNumber: 'MOF-10001',
        stampDutyUsdMinor: 100,
        stampDutyLbpMinor: 100_000,
        retentionYears: 10,
        effectiveFrom: '2026-09-01',
        reason: 'Owner approved the legal invoice and retention policy.',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(writer.createBillingPolicyVersion).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.invoice.create',
        supplierTaxRegistrationNumber: 'MOF-10001',
        stampDutyUsdMinor: 100,
        stampDutyLbpMinor: 100_000,
      }),
    );
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

describe('invoice document authorization and download evidence', () => {
  it('derives generation identity from the verified session and refuses cross-tenant requests', async () => {
    const writer = writerMocks();
    const { app } = await makeApp(claims, writer);
    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/invoice-documents`,
      headers: { 'idempotency-key': 'archive-request-001' },
      payload: { invoiceId: serviceId },
    });
    expect(allowed.statusCode).toBe(201);
    expect(writer.generateInvoiceDocument).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        actorId: claims.sub,
        branchIds: [branchId],
        auditAction: 'tenant.invoice.document.generate',
      }),
    );
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${otherTenantId}/operations/invoice-documents`,
      headers: { 'idempotency-key': 'archive-request-002' },
      payload: { invoiceId: serviceId },
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.generateInvoiceDocument).toHaveBeenCalledOnce();
    await app.close();
  });
  it('serves an attachment only after successful access audit', async () => {
    const writer = writerMocks();
    const { app, audit } = await makeApp(claims, writer);
    const url = `/v1/tenants/${tenantId}/operations/invoice-documents/${serviceId}/pdf`;
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toBe('%PDF-test');
    expect(writer.downloadInvoiceDocument).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ artifactId: serviceId, branchIds: [branchId] }),
    );
    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('Audit unavailable'));
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(500);
    await app.close();
  });
  it('denies downloads with no invoice permission', async () => {
    const writer = writerMocks();
    const { app } = await makeApp({ ...claims, permissions: [] }, writer);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/operations/invoice-documents/${serviceId}/pdf`,
    });
    expect(response.statusCode).toBe(403);
    expect(writer.downloadInvoiceDocument).not.toHaveBeenCalled();
    await app.close();
  });
});
describe('customer account authority', () => {
  const payload = {
    subscriberId: serviceId,
    currency: 'USD',
    amountMinor: 1000,
    documentNumber: 'DEP-100',
    sourceReference: 'BANK-100',
    reasonEn: 'Verified deposit receipt',
    reasonAr: 'دفعة مقدمة مثبتة بالإيصال',
  };
  it('requires payment permission and recent MFA, and signs context separately from the command', async () => {
    const writer = writerMocks();
    const url = '/v1/tenants/' + tenantId + '/operations/customer-accounts/deposit_received';
    const request = {
      method: 'POST' as const,
      url,
      headers: { 'idempotency-key': 'account-deposit-001' },
      payload,
    };
    const denied = await makeApp(claims, writer);
    expect((await denied.app.inject(request)).statusCode).toBe(403);
    await denied.app.close();
    const noMfa = await makeApp({ ...claims, permissions: ['tenant.payment.post'] }, writer);
    expect((await noMfa.app.inject(request)).statusCode).toBe(403);
    await noMfa.app.close();
    const allowed = await makeApp(
      {
        ...claims,
        permissions: ['tenant.payment.post'],
        mfaVerifiedAt: '2026-08-11T11:59:00.000Z',
      },
      writer,
    );
    expect((await allowed.app.inject(request)).statusCode).toBe(201);
    expect(writer.postCustomerAccountEntry).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        command: { ...payload, kind: 'deposit_received' },
        permission: 'tenant.payment.post',
        auditAction: 'tenant.customer_account.deposit_received',
        branchIds: [branchId],
        actorId: claims.sub,
        idempotencyKey: 'account-deposit-001',
      }),
    );
    expect(writer.postCustomerAccountEntry).toHaveBeenCalledTimes(1);
    // Unknown body fields cannot replace the server-chosen operation or authority.
    expect(
      (await allowed.app.inject({ ...request, payload: { ...payload, kind: 'credit_note' } }))
        .statusCode,
    ).not.toBe(201);
    expect(writer.postCustomerAccountEntry).toHaveBeenCalledTimes(1);
    expect(
      (await allowed.app.inject({ ...request, url: url.replace(tenantId, otherTenantId) }))
        .statusCode,
    ).toBe(403);
    await allowed.app.close();
  });
  it('requires billing view for the scoped account workspace', async () => {
    const writer = writerMocks();
    const url = '/v1/tenants/' + tenantId + '/operations/customer-accounts/workspace';
    const denied = await makeApp(claims, writer);
    expect((await denied.app.inject({ method: 'GET', url })).statusCode).toBe(403);
    await denied.app.close();
    const allowed = await makeApp({ ...claims, permissions: ['tenant.billing.view'] }, writer);
    expect((await allowed.app.inject({ method: 'GET', url })).statusCode).toBe(200);
    expect(writer.readCustomerAccounts).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.billing.view',
        auditAction: 'tenant.customer_account.read',
        branchIds: [branchId],
      }),
    );
    await allowed.app.close();
  });
});
describe('NOC incident routes', () => {
  it('serves scoped paged data and records a validated incident command', async () => {
    const writer = writerMocks(),
      { app } = await makeApp(
        { ...claims, permissions: ['tenant.network.view', 'tenant.network.job.create'] },
        writer,
      );
    const result = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/operations/noc/workspace?page=2&status=resolved`,
    });
    expect(result.statusCode).toBe(200);
    expect(writer.readNocWorkspace).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        branchIds: [branchId],
        routeIds: [routeId],
        query: { page: 2, pageSize: 25, status: 'resolved' },
      }),
    );
    const command = {
      routeId,
      serviceIds: [serviceId],
      severity: 'major',
      titleEn: 'Circuit interruption',
      titleAr: 'انقطاع الدارة الرئيسية',
      reasonEn: 'Confirmed by the operator',
      reasonAr: 'تم التحقق من الانقطاع بواسطة المشغل',
    };
    const created = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/noc/incidents`,
      headers: { 'idempotency-key': 'noc-create-test' },
      payload: { command },
    });
    expect(created.statusCode).toBe(201);
    expect(writer.createOutageIncident).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        command,
        permission: 'tenant.network.job.create',
        auditAction: 'tenant.noc.incident.create',
        idempotencyKey: 'noc-create-test',
      }),
    );
    await app.close();
  });
  it('denies missing authority/cross-tenant reads and does not accept invented impact counts', async () => {
    const writer = writerMocks(),
      { app } = await makeApp({ ...claims, permissions: ['tenant.network.view'] }, writer);
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/noc/incidents`,
      headers: { 'idempotency-key': 'noc-denied-test' },
      payload: {
        command: {
          routeId,
          serviceIds: [serviceId],
          severity: 'major',
          titleEn: 'Circuit interruption',
          titleAr: 'انقطاع الدارة الرئيسية',
          reasonEn: 'Confirmed by operator',
          reasonAr: 'تم التحقق بواسطة المشغل',
        },
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(writer.createOutageIncident).not.toHaveBeenCalled();
    const crossed = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${otherTenantId}/operations/noc/workspace`,
    });
    expect(crossed.statusCode).toBe(403);
    expect(writer.readNocWorkspace).not.toHaveBeenCalled();
    await app.close();
    const allowed = await makeApp(claims, writer);
    const bad = await allowed.app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/noc/incidents`,
      headers: { 'idempotency-key': 'noc-invalid-test' },
      payload: {
        command: {
          routeId,
          serviceIds: [serviceId],
          severity: 'major',
          titleEn: 'Circuit interruption',
          titleAr: 'انقطاع الدارة الرئيسية',
          reasonEn: 'Confirmed by operator',
          reasonAr: 'تم التحقق بواسطة المشغل',
          impactedSubscribersCount: 9000,
        },
      },
    });
    expect(bad.statusCode).not.toBe(201);
    expect(writer.createOutageIncident).not.toHaveBeenCalled();
    await allowed.app.close();
  });
  it('requires expected version and resolution evidence before invoking the writer', async () => {
    const writer = writerMocks(),
      { app } = await makeApp(claims, writer);
    const base = {
      method: 'POST' as const,
      url: `/v1/tenants/${tenantId}/operations/noc/incidents/transition`,
      headers: { 'idempotency-key': 'noc-transition-test' },
    };
    const command = {
      outageId: serviceId,
      expectedVersion: 3,
      status: 'resolved',
      reasonEn: 'Recovery observed at customer',
      reasonAr: 'تم التحقق من استعادة الخدمة لدى العميل',
    };
    const bad = await app.inject({ ...base, payload: { command } });
    expect(bad.statusCode).not.toBe(201);
    expect(writer.transitionOutageIncident).not.toHaveBeenCalled();
    const good = await app.inject({
      ...base,
      payload: {
        command: {
          ...command,
          rootCauseEn: 'Power supply was interrupted',
          rootCauseAr: 'انقطاع الطاقة في موقع الشبكة',
          resolutionEvidence: 'Power restored and service verified.',
        },
      },
    });
    expect(good.statusCode).toBe(201);
    expect(writer.transitionOutageIncident).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe('Warehouse custody routes', () => {
  it('requires scoped installation view authority for the workspace', async () => {
    const writer = writerMocks();
    const url = `/v1/tenants/${tenantId}/operations/warehouse/workspace`;
    const denied = await makeApp({ ...claims, permissions: [] }, writer);
    expect((await denied.app.inject({ method: 'GET', url })).statusCode).toBe(403);
    expect(writer.readWarehouseWorkspace).not.toHaveBeenCalled();
    await denied.app.close();
    const allowed = await makeApp({ ...claims, permissions: ['tenant.installation.view'] }, writer);
    expect((await allowed.app.inject({ method: 'GET', url })).statusCode).toBe(200);
    expect(writer.readWarehouseWorkspace).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.installation.view',
        auditAction: 'tenant.warehouse.workspace.read',
        branchIds: [branchId],
      }),
    );
    await allowed.app.close();
  });

  it('validates and forwards versioned bilingual custody evidence', async () => {
    const writer = writerMocks();
    const { app } = await makeApp(
      { ...claims, permissions: ['tenant.installation.manage'] },
      writer,
    );
    const command = {
      assetId: serviceId,
      expectedVersion: 1,
      action: 'issue' as const,
      installationId: '50000000-0000-4000-8000-000000000001',
      custodianUserId: '60000000-0000-4000-8000-000000000001',
      reasonEn: 'Assigned to customer installation',
      reasonAr: 'تم التسليم لتركيب خدمة العميل',
      evidence: 'Serial and equipment seal were verified.',
    };
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/custody`,
      headers: { 'idempotency-key': 'warehouse-custody-001' },
      payload: { command },
    });
    expect(response.statusCode).toBe(201);
    expect(writer.transitionInventoryCustody).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        command,
        permission: 'tenant.installation.manage',
        auditAction: 'tenant.warehouse.custody.transition',
        idempotencyKey: 'warehouse-custody-001',
      }),
    );
    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/custody`,
      headers: { 'idempotency-key': 'warehouse-custody-002' },
      payload: { command: { ...command, custodianUserId: undefined } },
    });
    expect(invalid.statusCode).not.toBe(201);
    expect(writer.transitionInventoryCustody).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('separates catalog procurement from MFA-protected finance approval', async () => {
    const writer = writerMocks();
    const evidence = {
      reasonEn: 'Approved for controlled warehouse replenishment',
      reasonAr: 'تم الاعتماد لتجديد المخزون بشكل مضبوط',
      evidence: 'Supplier quotation and approval record verified.',
    };
    const catalog = await makeApp({ ...claims, permissions: ['tenant.catalog.manage'] }, writer);
    const create = await catalog.app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/procurement`,
      headers: { 'idempotency-key': 'procurement-vendor-001' },
      payload: {
        command: {
          action: 'create_vendor',
          vendorCode: 'V-001',
          nameEn: 'Fiber supplier',
          nameAr: 'مورد الألياف',
          ...evidence,
        },
      },
    });
    expect(create.statusCode).toBe(201);
    expect(writer.executeProcurementCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.catalog.manage',
        auditAction: 'tenant.warehouse.procurement.manage',
      }),
    );
    await catalog.app.close();

    const approvalCommand = {
      action: 'approve_purchase_order' as const,
      purchaseOrderId: serviceId,
      expectedVersion: 1,
      ...evidence,
    };
    const withoutMfa = await makeApp(
      { ...claims, permissions: ['tenant.accounting.post'] },
      writer,
    );
    expect(
      (
        await withoutMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/procurement/approve`,
          headers: { 'idempotency-key': 'procurement-approve-001' },
          payload: { command: approvalCommand },
        })
      ).statusCode,
    ).toBe(403);
    await withoutMfa.app.close();
    const withMfa = await makeApp(
      {
        ...claims,
        permissions: ['tenant.accounting.post'],
        mfaVerifiedAt: '2026-08-11T11:59:00.000Z',
      },
      writer,
    );
    expect(
      (
        await withMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/procurement/approve`,
          headers: { 'idempotency-key': 'procurement-approve-002' },
          payload: { command: approvalCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeProcurementCommand).toHaveBeenLastCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.accounting.post',
        auditAction: 'tenant.warehouse.procurement.approve',
      }),
    );
    await withMfa.app.close();
  });

  it('signs warehouse administration with its own action and rejects unscoped callers', async () => {
    const writer = writerMocks();
    const evidence = {
      reasonEn: 'New fiber ONT stocked for the northern branch rollout',
      reasonAr: 'تم إدخال وحدة الألياف الجديدة لمخزون فرع الشمال',
      evidence: 'Catalog change request CR-2026-114 approved by operations.',
    };
    const createItem = {
      action: 'create_item' as const,
      sku: 'ONT-2100',
      nameEn: 'GPON ONT 2100',
      nameAr: 'وحدة ألياف 2100',
      category: 'ont_onu' as const,
      unitCostMinorUsd: 4200,
      unitCostMinorLbp: 0,
      serializedFlag: true,
      reorderThreshold: 25,
      ...evidence,
    };

    const administrator = await makeApp(
      { ...claims, permissions: ['tenant.catalog.manage'] },
      writer,
    );
    const created = await administrator.app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/administration`,
      headers: { 'idempotency-key': 'warehouse-admin-item-001' },
      payload: { command: createItem },
    });
    expect(created.statusCode).toBe(201);
    // Administration carries a different signed action than procurement, so a procurement
    // operator's signed context cannot be replayed to reshape the catalog.
    expect(writer.executeWarehouseAdminCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.catalog.manage',
        auditAction: 'tenant.warehouse.administration.manage',
      }),
    );
    await administrator.app.close();

    const withoutCatalog = await makeApp(
      { ...claims, permissions: ['tenant.installation.view'] },
      writer,
    );
    expect(
      (
        await withoutCatalog.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/administration`,
          headers: { 'idempotency-key': 'warehouse-admin-item-002' },
          payload: { command: createItem },
        })
      ).statusCode,
    ).toBe(403);
    await withoutCatalog.app.close();
  });

  it('rejects a warehouse administration payload with unknown or missing fields', async () => {
    const writer = writerMocks();
    const administrator = await makeApp(
      { ...claims, permissions: ['tenant.catalog.manage'] },
      writer,
    );
    const evidence = {
      reasonEn: 'Attempted catalog change without complete attributes',
      reasonAr: 'محاولة تغيير الفهرس بدون سمات كاملة',
      evidence: 'Rejected before reaching the database command.',
    };

    // An update is a full replacement: omitting `active` must be refused rather than
    // silently leaving the previous value in place.
    const missingField = await administrator.app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/administration`,
      headers: { 'idempotency-key': 'warehouse-admin-item-003' },
      payload: {
        command: {
          action: 'update_item',
          itemId: serviceId,
          expectedVersion: 1,
          nameEn: 'GPON ONT 2100',
          nameAr: 'وحدة ألياف 2100',
          category: 'ont_onu',
          unitCostMinorUsd: 4200,
          unitCostMinorLbp: 0,
          serializedFlag: true,
          reorderThreshold: 25,
          ...evidence,
        },
      },
    });
    expect(missingField.statusCode).toBe(400);

    const unknownField = await administrator.app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/administration`,
      headers: { 'idempotency-key': 'warehouse-admin-item-004' },
      payload: {
        command: {
          action: 'create_bin',
          warehouseId: serviceId,
          binCode: 'A-01',
          nameEn: 'Aisle A shelf 1',
          nameAr: 'الممر أ الرف ١',
          binKind: 'stock',
          capacity: 40,
          ...evidence,
        },
      },
    });
    expect(unknownField.statusCode).toBe(400);
    expect(writer.executeWarehouseAdminCommand).not.toHaveBeenCalled();
    await administrator.app.close();
  });

  it('separates moving stock from writing its value off', async () => {
    const writer = writerMocks();
    const evidence = {
      reasonEn: 'Rebalancing drop wire between the depot and the field store',
      reasonAr: 'إعادة توزيع أسلاك التوصيل بين المستودع ومخزن الميدان',
      evidence: 'Stock movement note SM-2026-311.',
    };
    const transferCommand = {
      action: 'transfer_stock' as const,
      itemId,
      quantity: 20,
      fromWarehouseId: serviceId,
      toWarehouseId: routeId,
      ...evidence,
    };

    // Moving stock is an operations action and needs no step-up.
    const operations = await makeApp(
      { ...claims, permissions: ['tenant.installation.manage'] },
      writer,
    );
    expect(
      (
        await operations.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/transfer`,
          headers: { 'idempotency-key': 'stock-transfer-001' },
          payload: { command: transferCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeStockCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.installation.manage',
        auditAction: 'tenant.warehouse.stock.transfer',
      }),
    );
    // An adjustment posts to the variance account, so the transfer route must refuse it.
    expect(
      (
        await operations.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/transfer`,
          headers: { 'idempotency-key': 'stock-transfer-002' },
          payload: {
            command: {
              action: 'adjust_stock',
              itemId,
              quantity: 3,
              warehouseId: serviceId,
              direction: 'decrease',
              currency: 'USD',
              ...evidence,
            },
          },
        })
      ).statusCode,
    ).toBe(400);
    await operations.app.close();

    const adjustCommand = {
      action: 'adjust_stock' as const,
      itemId,
      quantity: 3,
      warehouseId: serviceId,
      direction: 'decrease' as const,
      currency: 'USD' as const,
      ...evidence,
    };
    const withoutMfa = await makeApp(
      { ...claims, permissions: ['tenant.accounting.post'] },
      writer,
    );
    expect(
      (
        await withoutMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/adjust`,
          headers: { 'idempotency-key': 'stock-adjust-001' },
          payload: { command: adjustCommand },
        })
      ).statusCode,
    ).toBe(403);
    await withoutMfa.app.close();

    const withMfa = await makeApp(
      {
        ...claims,
        permissions: ['tenant.accounting.post'],
        mfaVerifiedAt: '2026-08-11T11:59:00.000Z',
      },
      writer,
    );
    expect(
      (
        await withMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/adjust`,
          headers: { 'idempotency-key': 'stock-adjust-002' },
          payload: { command: adjustCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeStockCommand).toHaveBeenLastCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.accounting.post',
        auditAction: 'tenant.warehouse.stock.adjust',
      }),
    );
    await withMfa.app.close();
  });

  it('rejects a transfer whose source and destination are the same location', async () => {
    const writer = writerMocks();
    const operations = await makeApp(
      { ...claims, permissions: ['tenant.installation.manage'] },
      writer,
    );
    const response = await operations.app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/operations/warehouse/stock/transfer`,
      headers: { 'idempotency-key': 'stock-transfer-003' },
      payload: {
        command: {
          action: 'transfer_stock',
          itemId,
          quantity: 5,
          fromWarehouseId: serviceId,
          toWarehouseId: serviceId,
          reasonEn: 'Attempted no-op transfer between identical locations',
          reasonAr: 'محاولة نقل بين موقعين متطابقين',
          evidence: 'Rejected before reaching the database command.',
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(writer.executeStockCommand).not.toHaveBeenCalled();
    await operations.app.close();
  });

  it('signs stock reservations with their own action and refuses a finance-only session', async () => {
    const writer = writerMocks();
    const reserveCommand = {
      action: 'reserve_stock' as const,
      itemId,
      quantity: 4,
      warehouseId: serviceId,
      installationId: routeId,
      reference: 'JP-2026-778',
      reasonEn: 'Material held for the scheduled customer installation',
      reasonAr: 'مواد محجوزة للتركيب المجدول للعميل',
      evidence: 'Job pack JP-2026-778 issued to the field team.',
    };

    const operations = await makeApp(
      { ...claims, permissions: ['tenant.installation.manage'] },
      writer,
    );
    expect(
      (
        await operations.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/reservations`,
          headers: { 'idempotency-key': 'stock-reserve-001' },
          payload: { command: reserveCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeStockReservationCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.installation.manage',
        auditAction: 'tenant.warehouse.stock.reserve',
      }),
    );
    await operations.app.close();

    // Holding stock for a job is field authority; a finance-only session has none.
    const finance = await makeApp({ ...claims, permissions: ['tenant.accounting.post'] }, writer);
    expect(
      (
        await finance.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/reservations`,
          headers: { 'idempotency-key': 'stock-reserve-002' },
          payload: { command: reserveCommand },
        })
      ).statusCode,
    ).toBe(403);
    await finance.app.close();
  });

  it('separates counting stock from posting its variance', async () => {
    const writer = writerMocks();
    const evidence = {
      reasonEn: 'Quarterly physical count of the receiving bay',
      reasonAr: 'الجرد الفعلي الربعي لساحة الاستلام',
      evidence: 'Count sheet CS-2026-042 signed by the warehouse supervisor.',
    };
    const openCommand = {
      action: 'open_count' as const,
      countNumber: 'CS-2026-042',
      warehouseId: serviceId,
      currency: 'USD' as const,
      ...evidence,
    };
    const closeCommand = {
      action: 'close_count' as const,
      countId: serviceId,
      expectedVersion: 2,
      ...evidence,
    };

    const warehouse = await makeApp(
      { ...claims, permissions: ['tenant.installation.manage'] },
      writer,
    );
    expect(
      (
        await warehouse.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/counts`,
          headers: { 'idempotency-key': 'stock-count-001' },
          payload: { command: openCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeStockCountCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.installation.manage',
        auditAction: 'tenant.warehouse.stock.count',
      }),
    );
    // Closing posts variance, so the warehouse route must refuse it outright.
    expect(
      (
        await warehouse.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/counts`,
          headers: { 'idempotency-key': 'stock-count-002' },
          payload: { command: closeCommand },
        })
      ).statusCode,
    ).toBe(400);
    await warehouse.app.close();

    const withoutMfa = await makeApp(
      { ...claims, permissions: ['tenant.accounting.post'] },
      writer,
    );
    expect(
      (
        await withoutMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/counts/close`,
          headers: { 'idempotency-key': 'stock-count-003' },
          payload: { command: closeCommand },
        })
      ).statusCode,
    ).toBe(403);
    await withoutMfa.app.close();

    const withMfa = await makeApp(
      {
        ...claims,
        permissions: ['tenant.accounting.post'],
        mfaVerifiedAt: '2026-08-11T11:59:00.000Z',
      },
      writer,
    );
    expect(
      (
        await withMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/stock/counts/close`,
          headers: { 'idempotency-key': 'stock-count-004' },
          payload: { command: closeCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeStockCountCommand).toHaveBeenLastCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.accounting.post',
        auditAction: 'tenant.warehouse.stock.count.close',
      }),
    );
    await withMfa.app.close();
  });

  it('separates repair handling from writing a device off', async () => {
    const writer = writerMocks();
    const evidence = {
      reasonEn: 'Device failed acceptance testing after return from the field',
      reasonAr: 'فشل الجهاز في اختبار القبول بعد إرجاعه من الميدان',
      evidence: 'Fault report FR-2026-091 attached to the vendor claim.',
    };
    const openCommand = {
      action: 'open_case' as const,
      caseNumber: 'RMA-2026-011',
      assetId: itemId,
      faultSummary: 'Optical transmit power below the acceptance threshold on both ports.',
      ...evidence,
    };
    const scrapCommand = {
      action: 'scrap_asset' as const,
      caseId: serviceId,
      expectedVersion: 1,
      ...evidence,
    };

    const warehouse = await makeApp(
      { ...claims, permissions: ['tenant.installation.manage'] },
      writer,
    );
    expect(
      (
        await warehouse.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/rma`,
          headers: { 'idempotency-key': 'rma-open-001' },
          payload: { command: openCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeRmaCommand).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.installation.manage',
        auditAction: 'tenant.warehouse.rma.manage',
      }),
    );
    // Writing a device off destroys value, so the warehouse route must refuse it.
    expect(
      (
        await warehouse.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/rma`,
          headers: { 'idempotency-key': 'rma-open-002' },
          payload: { command: scrapCommand },
        })
      ).statusCode,
    ).toBe(400);
    await warehouse.app.close();

    const withMfa = await makeApp(
      {
        ...claims,
        permissions: ['tenant.accounting.post'],
        mfaVerifiedAt: '2026-08-11T11:59:00.000Z',
      },
      writer,
    );
    expect(
      (
        await withMfa.app.inject({
          method: 'POST',
          url: `/v1/tenants/${tenantId}/operations/warehouse/rma/scrap`,
          headers: { 'idempotency-key': 'rma-scrap-001' },
          payload: { command: scrapCommand },
        })
      ).statusCode,
    ).toBe(201);
    expect(writer.executeRmaCommand).toHaveBeenLastCalledWith(
      tenantId,
      expect.objectContaining({
        permission: 'tenant.accounting.post',
        auditAction: 'tenant.warehouse.rma.scrap',
      }),
    );
    await withMfa.app.close();
  });
});
