import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  acceptSalesQuote,
  approveSalesQuote,
  createDatabase,
  createOperationsPlanVersion,
  createSalesLead,
  createSalesOfferVersion,
  createSalesOrderInstallation,
  createSalesQuote,
  convertSalesOrderSubscriber,
  createCapacityResource,
  inOperationsTransaction,
  qualifySalesLead,
  readSalesWorkspace,
  reserveSalesOrderResource,
  signOperationsAttestation,
  transitionInstallation,
} from '../src/index.js';

const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error(
      'Sales integration requires SALES_TEST_ADMIN_DATABASE_URL and SALES_TEST_RUNTIME_DATABASE_URL.',
    );
  }
  console.log('Sales integration skipped: live tenant database URLs are not configured.');
  process.exit(0);
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const tenantId = randomUUID() as VerifiedTenantId;
const actorId = randomUUID();
const branchId = randomUUID();
const areaId = randomUUID();
const routeId = randomUUID();
const keyId = `sales-live-${randomUUID()}`;
const secret = randomBytes(32);

function authorization(
  permission: Permission,
  action: string,
  idempotencyKey: string,
  scope: {
    readonly branchIds?: readonly string[];
    readonly areaIds?: readonly string[];
    readonly routeIds?: readonly string[];
  } = { branchIds: [branchId], areaIds: [areaId], routeIds: [routeId] },
) {
  return signOperationsAttestation(
    {
      keyId,
      tenantId,
      actorId,
      sessionId: randomUUID(),
      permission,
      action,
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'orvex-sales-live-test',
      reason: 'Live lead-to-order acceptance evidence',
      idempotencyKey,
      ...scope,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    secret,
  );
}

try {
  await admin`INSERT INTO tenants(id,code,brand_name,legal_name,status)
    VALUES (${tenantId},${`SALES-${tenantId}`},'Sales Live','Sales Live LLC','active')`;
  await admin`INSERT INTO users(id,account_kind,email,display_name,password_hash,mfa_required)
    VALUES (${actorId},'tenant',${`${actorId}@sales.invalid`},'Sales Manager','disabled-live-hash',true)`;
  await admin`INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope)
    VALUES (${tenantId},${actorId},'isp_administrator',ARRAY[
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
      'tenant.subscriber.create','tenant.user.administer','tenant.network.view',
      'tenant.network.job.create','tenant.invoice.create','tenant.installation.manage',
      'tenant.installation.view'
    ],${JSON.stringify({ branchIds: [branchId], areaIds: [areaId], routeIds: [routeId] })}::jsonb)`;
  await admin`INSERT INTO operations_context_keys(key_id,secret,active_from)
    VALUES (${keyId},decode(${secret.toString('hex')},'hex'),clock_timestamp()-interval '1 minute')`;

  await inOperationsTransaction(
    runtime.db,
    tenantId,
    authorization('tenant.user.administer', 'tenant.operations.configure', 'sales-scope-seed-001', {
      branchIds: [branchId],
    }),
    async (transaction) => {
      await transaction.execute(sql`INSERT INTO operations_branches(id,tenant_id,code,name_en,name_ar)
        VALUES (${branchId},${tenantId},'BEY','Beirut','بيروت')`);
      await transaction.execute(sql`INSERT INTO operations_areas(id,tenant_id,branch_id,code,name_en,name_ar)
        VALUES (${areaId},${tenantId},${branchId},'HAM','Hamra','الحمرا')`);
      await transaction.execute(sql`INSERT INTO operations_routes(id,tenant_id,branch_id,area_id,code,name_en,name_ar)
        VALUES (${routeId},${tenantId},${branchId},${areaId},'HAM-01','Hamra 01','الحمرا ٠١')`);
    },
  );

  const lead = await createSalesLead(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.sales.manage',
      'tenant.sales.lead.create',
      'sales-lead-001',
    ),
    leadNumber: `LEAD-${randomUUID().slice(0, 8)}`,
    partyKind: 'business',
    displayName: 'Lebanon Live Test Company',
    source: 'referral',
    primaryPhone: '+9611000000',
    branchId,
    areaId,
    routeId,
    addressLine: 'Hamra, Beirut',
    needsSummary: 'A resilient business fiber service with a committed support path.',
    assignedTo: actorId,
    idempotencyKey: 'sales-lead-001',
  });
  assert.equal(lead.status, 'new');

  const offer = await createSalesOfferVersion(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.catalog.manage',
      'tenant.catalog.offer.version.create',
      'sales-offer-001',
    ),
    branchId,
    code: `BIZ-${randomUUID().slice(0, 6)}`,
    version: 1,
    nameEn: 'Business Fiber 100',
    nameAr: 'فايبر أعمال ١٠٠',
    accessTechnology: 'fiber',
    downstreamMbps: 100,
    upstreamMbps: 50,
    recurringAmountMinor: 12_500,
    activationFeeMinor: 5_000,
    equipmentFeeMinor: 10_000,
    currency: 'USD',
    commitmentMonths: 12,
    eligibility: { technology: 'fiber' },
    policy: { fup: 'business-fair-use-v1' },
    effectiveFrom: new Date().toISOString().slice(0, 10),
    createdBy: actorId,
    idempotencyKey: 'sales-offer-001',
  });

  const qualification = await qualifySalesLead(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.sales.manage',
      'tenant.sales.qualify',
      'sales-qualify-001',
    ),
    leadId: lead.id,
    result: 'eligible',
    accessTechnology: 'fiber',
    coverageSource: 'POP capacity and building survey',
    reasonCodes: ['coverage_confirmed', 'capacity_available'],
    evidence: { pop: 'BEY-HAM-01', survey: 'passed' },
    capacityReference: 'CAP-BEY-HAM-01',
    qualifiedBy: actorId,
    idempotencyKey: 'sales-qualify-001',
  });
  assert.equal(qualification.result, 'eligible');

  const quote = await createSalesQuote(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.sales.manage',
      'tenant.sales.quote.create',
      'sales-quote-001',
    ),
    leadId: lead.id,
    offerVersionId: offer.id,
    quoteNumber: `Q-${randomUUID().slice(0, 8)}`,
    version: 1,
    discountBasisPoints: 800,
    validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    terms: { acceptance: 'signed_contract' },
    createdBy: actorId,
    idempotencyKey: 'sales-quote-001',
  });
  assert.equal(quote.status, 'pending_approval');

  await assert.rejects(
    approveSalesQuote(runtime.db, tenantId, {
      authorization: authorization(
        'tenant.sales.manage',
        'tenant.sales.quote.approve',
        'sales-approval-denied-001',
      ),
      quoteId: quote.id,
      approvedBy: actorId,
      idempotencyKey: 'sales-approval-denied-001',
    }),
    /authorize|policy|permission/i,
  );

  const approved = await approveSalesQuote(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.catalog.manage',
      'tenant.sales.quote.approve',
      'sales-approval-001',
    ),
    quoteId: quote.id,
    approvedBy: actorId,
    idempotencyKey: 'sales-approval-001',
  });
  assert.equal(approved.status, 'approved');

  const order = await acceptSalesQuote(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.order.manage',
      'tenant.sales.quote.accept',
      'sales-order-001',
    ),
    quoteId: quote.id,
    orderNumber: `SO-${randomUUID().slice(0, 8)}`,
    acceptedBy: 'Authorized customer representative',
    acceptanceReference: 'SIGNED-CONTRACT-LIVE-001',
    ownerId: actorId,
    idempotencyKey: 'sales-order-001',
  });
  assert.equal(order.tasks.length, 6);
  assert.equal(order.tasks[0]?.status, 'completed');
  assert.equal(order.tasks[1]?.status, 'ready');

  const conversionInput = {
    authorization: authorization(
      'tenant.subscriber.create' as const,
      'tenant.subscriber.create',
      'sales-order-subscriber-001',
    ),
    orderId: order.id,
    subscriberNumber: `SUB-${randomUUID().slice(0, 8)}`,
    householdReference: `HH-${randomUUID().slice(0, 8)}`,
    locationLabel: 'Primary service location',
    areaCode: 'BEY-HAM',
    actorId,
    idempotencyKey: 'sales-order-subscriber-001',
  };
  const conversion = await convertSalesOrderSubscriber(runtime.db, tenantId, conversionInput);
  assert.equal(conversion.replayed, false);
  const conversionReplay = await convertSalesOrderSubscriber(runtime.db, tenantId, conversionInput);
  assert.equal(conversionReplay.replayed, true);
  assert.equal(conversionReplay.subscriberId, conversion.subscriberId);

  const resource = await createCapacityResource(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.network.job.create',
      'tenant.resource.create',
      'sales-resource-001',
    ),
    type: 'fiber_port',
    code: `OLT-${randomUUID().slice(0, 8)}`,
    name: 'Beirut live-test fiber port',
    accessTechnology: 'fiber',
    totalUnits: 8,
    branchId,
    areaId,
    metadata: { olt: 'BEY-LIVE-01' },
    actorId,
    idempotencyKey: 'sales-resource-001',
  });
  assert.equal(resource.availableUnits, 8);

  const reservationInput = {
    authorization: authorization(
      'tenant.network.job.create' as const,
      'tenant.resource.reserve',
      'sales-resource-reserve-001',
    ),
    orderId: order.id,
    resourceId: resource.id,
    units: 1,
    actorId,
    idempotencyKey: 'sales-resource-reserve-001',
  };
  const reservation = await reserveSalesOrderResource(runtime.db, tenantId, reservationInput);
  assert.equal(reservation.replayed, false);
  const reservationReplay = await reserveSalesOrderResource(runtime.db, tenantId, reservationInput);
  assert.equal(reservationReplay.replayed, true);
  assert.equal(reservationReplay.reservationId, reservation.reservationId);

  const plan = await createOperationsPlanVersion(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.invoice.create',
      'tenant.plan.version.create',
      'sales-plan-001',
    ),
    branchId,
    code: `PLAN-${randomUUID().slice(0, 6)}`,
    nameEn: 'Business Fiber 100 Operations Plan',
    nameAr: 'خطة تشغيل فايبر أعمال ١٠٠',
    version: 1,
    recurringAmountMinor: 12_500,
    currency: 'USD',
    billingIntervalMonths: 1,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    createdBy: actorId,
    idempotencyKey: 'sales-plan-001',
  });

  const installationInput = {
    authorization: authorization(
      'tenant.installation.manage' as const,
      'tenant.service.installation.create',
      'sales-installation-001',
    ),
    orderId: order.id,
    planId: plan.planId,
    serviceNumber: `SVC-${randomUUID().slice(0, 8)}`,
    billingAnchorDay: 1,
    actorId,
    idempotencyKey: 'sales-installation-001',
  };
  const installation = await createSalesOrderInstallation(runtime.db, tenantId, installationInput);
  assert.equal(installation.replayed, false);
  const installationReplay = await createSalesOrderInstallation(
    runtime.db,
    tenantId,
    installationInput,
  );
  assert.equal(installationReplay.replayed, true);
  assert.equal(installationReplay.installationId, installation.installationId);

  const scheduled = await transitionInstallation(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.installation.manage',
      'tenant.installation.transition',
      'sales-installation-schedule-001',
    ),
    installationId: installation.installationId,
    expectedVersion: 1,
    toStatus: 'scheduled',
    note: 'Installation appointment confirmed for live proof',
    evidence: {
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      installerUserId: actorId,
    },
    actorId,
    idempotencyKey: 'sales-installation-schedule-001',
  });
  const inProgress = await transitionInstallation(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.installation.manage',
      'tenant.installation.transition',
      'sales-installation-start-001',
    ),
    installationId: installation.installationId,
    expectedVersion: scheduled.version,
    toStatus: 'in_progress',
    evidence: {},
    actorId,
    idempotencyKey: 'sales-installation-start-001',
  });
  const completionEvidence = {
    signalTest: '-18.2 dBm optical receive power; pass',
    equipmentSerial: 'ONT-LIVE-0001',
    completedAt: new Date().toISOString(),
  };
  const readyForActivation = await transitionInstallation(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.installation.manage',
      'tenant.installation.transition',
      'sales-installation-ready-001',
    ),
    installationId: installation.installationId,
    expectedVersion: inProgress.version,
    toStatus: 'ready_for_activation',
    note: 'Field evidence verified before activation handoff',
    evidence: completionEvidence,
    actorId,
    idempotencyKey: 'sales-installation-ready-001',
  });
  const completedInstallation = await transitionInstallation(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.installation.manage',
      'tenant.installation.transition',
      'sales-installation-complete-001',
    ),
    installationId: installation.installationId,
    expectedVersion: readyForActivation.version,
    toStatus: 'completed',
    note: 'Installation completion released network activation',
    evidence: completionEvidence,
    actorId,
    idempotencyKey: 'sales-installation-complete-001',
  });
  assert.equal(completedInstallation.status, 'completed');

  const workspace = await readSalesWorkspace(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.sales.view',
      'tenant.sales.workspace.read',
      'sales-read-001',
    ),
  });
  assert.equal(workspace.leads[0]?.status, 'won');
  assert.equal(workspace.quotes[0]?.status, 'accepted');
  assert.equal(workspace.orders[0]?.tasks.length, 6);
  assert.equal(workspace.orders[0]?.subscriberId, conversion.subscriberId);
  assert.equal(workspace.orders[0]?.tasks[1]?.status, 'completed');
  assert.equal(workspace.orders[0]?.tasks[2]?.status, 'completed');
  assert.equal(workspace.orders[0]?.tasks[3]?.status, 'completed');
  assert.equal(workspace.orders[0]?.tasks[4]?.status, 'ready');
  assert.equal(workspace.resources[0]?.reservedUnits, 1);
  assert.equal(workspace.resources[0]?.availableUnits, 7);
  assert.equal(workspace.installations[0]?.status, 'completed');
  assert.equal(workspace.installations[0]?.orderId, order.id);
  assert.equal(workspace.plans[0]?.id, plan.planId);
  assert.equal(workspace.scopes.routes[0]?.id, routeId);

  const [audit] = await admin`SELECT count(*)::integer AS count,
    bool_and(actor_id=${actorId}::text) AS actor_matches
    FROM operations_audit_outbox WHERE tenant_id=${tenantId}
      AND action IN ('tenant.sales.lead.create','tenant.sales.qualify','tenant.catalog.offer.version.create',
        'tenant.sales.quote.create','tenant.sales.quote.approve','tenant.sales.quote.accept',
        'tenant.sales.workspace.read','tenant.subscriber.create','tenant.resource.create',
        'tenant.resource.reserve','tenant.plan.version.create','tenant.service.installation.create',
        'tenant.installation.transition')`;
  assert((audit?.count ?? 0) >= 40, 'the sales vertical must emit atomic record and read evidence');
  assert.equal(audit?.actor_matches, true);
  console.log('Sales lead-to-completed-installation live checks passed');
} finally {
  await Promise.allSettled([admin.end(), runtime.client.end()]);
}
