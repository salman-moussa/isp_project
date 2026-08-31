import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
  acceptSalesQuote,
  approveSalesQuote,
  createDatabase,
  createBillingPolicyVersion,
  createOperationsPlanVersion,
  createSalesLead,
  createSalesOfferVersion,
  createSalesOrderInstallation,
  createSalesQuote,
  convertSalesOrderSubscriber,
  createCapacityResource,
  enqueueSalesOrderActivation,
  executeSalesOrderCommand,
  inOperationsTransaction,
  qualifySalesLead,
  postSalesOrderFirstInvoice,
  readSalesWorkspace,
  readSubscriberWorkspace,
  reserveSalesOrderResource,
  signOperationsAttestation,
  transitionInstallation,
} from '../src/index.js';

const adminUrl = process.env.SALES_TEST_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.SALES_TEST_RUNTIME_DATABASE_URL;
const networkWorkerUrl = process.env.SALES_TEST_NETWORK_WORKER_DATABASE_URL;
if (!adminUrl || !runtimeUrl || !networkWorkerUrl) {
  if (process.env.ORVEX_REQUIRE_LIVE_POSTGRES === '1') {
    throw new Error('Sales integration requires admin, runtime, and Network Worker database URLs.');
  }
  console.log('Sales integration skipped: live tenant database URLs are not configured.');
  process.exit(0);
}

const admin = postgres(adminUrl, { max: 2, prepare: false });
const runtime = createDatabase(runtimeUrl);
const networkWorker = postgres(networkWorkerUrl, { max: 1, prepare: false });
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
  await admin`SELECT record_operations_platform_subscription_state(
    ${randomUUID()}::uuid,${tenantId}::uuid,'active',1,clock_timestamp()
  )`;
  await admin`INSERT INTO users(id,account_kind,email,display_name,password_hash,mfa_required)
    VALUES (${actorId},'tenant',${`${actorId}@sales.invalid`},'Sales Manager','disabled-live-hash',true)`;
  await admin`INSERT INTO tenant_memberships(tenant_id,user_id,role_key,permissions,scope)
    VALUES (${tenantId},${actorId},'isp_administrator',ARRAY[
      'tenant.sales.view','tenant.sales.manage','tenant.catalog.manage','tenant.order.manage',
      'tenant.subscriber.view','tenant.subscriber.create','tenant.user.administer','tenant.network.view',
      'tenant.network.job.create','tenant.invoice.create','tenant.installation.manage',
      'tenant.invoice.post',
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

  const holdInput = {
    authorization: authorization(
      'tenant.order.manage' as const,
      'tenant.order.command',
      'sales-order-hold-001',
    ),
    orderId: order.id,
    command: 'place_on_hold' as const,
    reason: 'Customer requested a documented installation scheduling pause',
    actorId,
    idempotencyKey: 'sales-order-hold-001',
  };
  const held = await executeSalesOrderCommand(runtime.db, tenantId, holdInput);
  assert.equal(held.orderStatus, 'on_hold');
  assert.equal(held.replayed, false);
  const heldReplay = await executeSalesOrderCommand(runtime.db, tenantId, holdInput);
  assert.equal(heldReplay.orderStatus, 'on_hold');
  assert.equal(heldReplay.replayed, true);
  const resumed = await executeSalesOrderCommand(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.order.manage',
      'tenant.order.command',
      'sales-order-resume-001',
    ),
    orderId: order.id,
    command: 'resume',
    reason: 'Customer confirmed the installation schedule may continue',
    actorId,
    idempotencyKey: 'sales-order-resume-001',
  });
  assert.equal(resumed.orderStatus, 'in_progress');

  await inOperationsTransaction(
    runtime.db,
    tenantId,
    authorization('tenant.order.manage', 'tenant.order.command', 'sales-order-fallout-seed-001'),
    async (transaction) => {
      await transaction.execute(sql`
        UPDATE sales_order_tasks SET status='failed',last_error='test-only dependency failure'
        WHERE tenant_id=${tenantId} AND order_id=${order.id} AND task_key='subscriber_creation'
      `);
    },
  );
  const falloutWorkspace = await readSalesWorkspace(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.sales.view',
      'tenant.sales.workspace.read',
      'sales-read-fallout-001',
    ),
  });
  assert.equal(falloutWorkspace.orders[0]?.status, 'fallout');
  assert.equal(falloutWorkspace.orders[0]?.tasks[1]?.status, 'failed');
  assert.equal(falloutWorkspace.orders[0]?.tasks[1]?.lastError, 'test-only dependency failure');
  const retried = await executeSalesOrderCommand(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.order.manage',
      'tenant.order.command',
      'sales-order-retry-001',
    ),
    orderId: order.id,
    command: 'retry_task',
    taskKey: 'subscriber_creation',
    reason: 'The dependency fault was resolved and verified by operations',
    actorId,
    idempotencyKey: 'sales-order-retry-001',
  });
  assert.equal(retried.orderStatus, 'in_progress');

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
  await assert.rejects(
    executeSalesOrderCommand(runtime.db, tenantId, {
      authorization: authorization(
        'tenant.order.manage',
        'tenant.order.command',
        'sales-order-cancel-denied-001',
      ),
      orderId: order.id,
      command: 'cancel',
      reason: 'Attempted cancellation after subscriber conversion',
      actorId,
      idempotencyKey: 'sales-order-cancel-denied-001',
    }),
    /governed service termination/i,
  );

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
    networkProfileReference: 'profile-business-fiber-100',
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

  const routerId = `router-${randomUUID().slice(0, 8)}`;
  await admin`SELECT network_worker.register_router(
    ${tenantId},${routerId},'https://router.live.invalid/','secret://routers/live-test',
    'simulator',true
  )`;
  await admin`SELECT network_worker.register_service_binding(
    ${tenantId}::uuid,${installation.serviceId}::uuid,${routerId},'subscriber-live-test',
    'secret://subscribers/live-test','pool-live-test',NULL,NULL,true
  )`;
  const activationInput = {
    authorization: authorization(
      'tenant.network.job.create' as const,
      'tenant.network.job.create',
      'sales-network-activate-001',
    ),
    orderId: order.id,
    actorId,
    idempotencyKey: 'sales-network-activate-001',
  };
  const activation = await enqueueSalesOrderActivation(runtime.db, tenantId, activationInput);
  assert.equal(activation.replayed, false);
  const activationReplay = await enqueueSalesOrderActivation(runtime.db, tenantId, activationInput);
  assert.equal(activationReplay.replayed, true);
  assert.equal(activationReplay.outboxId, activation.outboxId);

  const [claimed] = await networkWorker`SELECT * FROM network_worker.claim_job(
    'sales-live-worker',clock_timestamp(),60000
  )`;
  assert(claimed?.job && claimed.lease_token, 'the durable activation job must be claimable');
  const completedAt = new Date().toISOString();
  const succeededJob = {
    ...(claimed.job as Record<string, unknown>),
    state: 'succeeded',
    availableAt: completedAt,
    attempts: [
      {
        attempt: 1,
        startedAt: completedAt,
        finishedAt: completedAt,
        outcome: {
          classification: 'definite_success',
          requestId: (claimed.job as { request: { requestId: string } }).request.requestId,
          observed: {
            accountName: 'subscriber-live-test',
            enabled: true,
            profileId: 'profile-business-fiber-100',
            ipAssignment: { mode: 'dynamic', poolId: 'pool-live-test' },
          },
          latencyMs: 3,
        },
      },
    ],
  };
  const [saved] = await networkWorker`SELECT network_worker.save_job(
    'sales-live-worker',${claimed.lease_token}::uuid,${networkWorker.json(succeededJob)}::jsonb
  ) AS saved`;
  assert.equal(saved?.saved, true);

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
  assert.equal(workspace.orders[0]?.tasks[4]?.status, 'completed');
  assert.equal(workspace.orders[0]?.tasks[5]?.status, 'ready');
  assert.equal(workspace.resources[0]?.reservedUnits, 1);
  assert.equal(workspace.resources[0]?.availableUnits, 7);
  assert.equal(workspace.installations[0]?.status, 'completed');
  assert.equal(workspace.installations[0]?.orderId, order.id);
  assert.equal(workspace.plans[0]?.id, plan.planId);
  assert.equal(workspace.scopes.routes[0]?.id, routeId);

  const activationDate = workspace.installations[0]?.serviceActivatedAt?.slice(0, 10);
  assert(activationDate, 'verified activation must expose the immutable service activation date');
  const billingPolicy = await createBillingPolicyVersion(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.invoice.create',
      'tenant.billing.policy.version.create',
      'sales-billing-policy-001',
      { branchIds: [branchId] },
    ),
    branchId,
    version: 1,
    vatRateBasisPoints: 1100,
    roundingMode: 'half_up',
    effectiveFrom: activationDate,
    createdBy: actorId,
    idempotencyKey: 'sales-billing-policy-001',
  });
  assert.equal(billingPolicy.replayed, false);
  const billingPeriodEnd = new Date(`${activationDate}T00:00:00.000Z`);
  billingPeriodEnd.setUTCDate(billingPeriodEnd.getUTCDate() + 30);
  const firstBillingInput = {
    authorization: authorization(
      'tenant.invoice.post' as const,
      'tenant.order.first_invoice.post',
      'sales-first-billing-001',
    ),
    orderId: order.id,
    documentNumber: `INV-${order.orderNumber}-001`,
    periodStart: activationDate,
    periodEnd: billingPeriodEnd.toISOString().slice(0, 10),
    actorId,
    idempotencyKey: 'sales-first-billing-001',
  };
  const firstBilling = await postSalesOrderFirstInvoice(runtime.db, tenantId, firstBillingInput);
  assert.equal(firstBilling.replayed, false);
  assert.equal(firstBilling.amountMinor, 13_875);
  const firstBillingReplay = await postSalesOrderFirstInvoice(
    runtime.db,
    tenantId,
    firstBillingInput,
  );
  assert.equal(firstBillingReplay.replayed, true);
  assert.equal(firstBillingReplay.invoiceId, firstBilling.invoiceId);

  const completedWorkspace = await readSalesWorkspace(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.sales.view',
      'tenant.sales.workspace.read',
      'sales-read-completed-001',
    ),
  });
  assert.equal(completedWorkspace.orders[0]?.status, 'completed');
  assert.equal(completedWorkspace.orders[0]?.tasks[5]?.status, 'completed');
  assert.equal(completedWorkspace.orders[0]?.firstInvoiceId, firstBilling.invoiceId);
  assert.equal(completedWorkspace.billingPolicies[0]?.id, billingPolicy.id);
  const [posted] =
    await admin`SELECT invoice.entry_kind,invoice.amount_minor::integer AS amount_minor,
    preparation.posting_status,run.status AS run_status,preparation.service_id
    FROM finance_invoices invoice
    JOIN operations_invoice_preparations preparation
      ON preparation.tenant_id=invoice.tenant_id AND preparation.finance_invoice_id=invoice.id
    JOIN operations_billing_runs run
      ON run.tenant_id=preparation.tenant_id AND run.id=preparation.billing_run_id
    WHERE invoice.tenant_id=${tenantId} AND invoice.id=${firstBilling.invoiceId}`;
  assert.equal(posted?.entry_kind, 'posted');
  assert.equal(posted?.amount_minor, 13_875);
  assert.equal(posted?.posting_status, 'posted');
  assert.equal(posted?.run_status, 'succeeded');
  assert.equal(posted?.service_id, installation.serviceId);
  const subscriberWorkspace = await readSubscriberWorkspace(runtime.db, tenantId, {
    authorization: authorization(
      'tenant.subscriber.view',
      'tenant.subscriber.workspace.read',
      'subscriber-workspace-read-001',
    ),
  });
  assert.equal(subscriberWorkspace.subscribers[0]?.id, conversion.subscriberId);
  assert.equal(subscriberWorkspace.subscribers[0]?.routeCode, 'HAM-01');
  assert.equal(subscriberWorkspace.subscribers[0]?.contacts[0]?.kind, 'phone');
  assert.equal(subscriberWorkspace.services[0]?.id, installation.serviceId);
  assert.equal(subscriberWorkspace.services[0]?.status, 'active');
  assert.equal(subscriberWorkspace.services[0]?.installationStatus, 'completed');
  assert.equal(subscriberWorkspace.invoices[0]?.id, firstBilling.invoiceId);
  assert.equal(subscriberWorkspace.invoices[0]?.outstandingMinor, 13_875);

  const [audit] = await admin`SELECT count(*)::integer AS count,
    bool_and(actor_id=${actorId}::text) AS actor_matches
    FROM operations_audit_outbox WHERE tenant_id=${tenantId}
      AND action IN ('tenant.sales.lead.create','tenant.sales.qualify','tenant.catalog.offer.version.create',
        'tenant.sales.quote.create','tenant.sales.quote.approve','tenant.sales.quote.accept',
        'tenant.sales.workspace.read','tenant.subscriber.create','tenant.resource.create',
        'tenant.resource.reserve','tenant.plan.version.create','tenant.service.installation.create',
        'tenant.installation.transition','tenant.network.job.create','tenant.network.job.complete',
        'tenant.billing.policy.version.create','tenant.order.first_invoice.post',
        'tenant.order.command','tenant.subscriber.workspace.read')`;
  assert((audit?.count ?? 0) >= 63, 'the sales vertical must emit atomic record and read evidence');
  assert.equal(audit?.actor_matches, true);
  const [financeAudit] = await admin`SELECT count(*)::integer AS count,
    bool_and(actor_id=${actorId}::text) AS actor_matches
    FROM finance_audit_outbox WHERE tenant_id=${tenantId}
      AND action='tenant.invoice.post' AND permission='tenant.invoice.post'`;
  assert((financeAudit?.count ?? 0) >= 1, 'first billing must emit immutable finance evidence');
  assert.equal(financeAudit?.actor_matches, true);
  const [commandHistory] = await admin`SELECT count(*)::integer AS count
    FROM sales_order_commands WHERE tenant_id=${tenantId} AND order_id=${order.id}`;
  assert.equal(commandHistory?.count, 3);
  console.log('Sales lead-to-activated-and-billed-order live checks passed');
} finally {
  await Promise.allSettled([admin.end(), runtime.client.end(), networkWorker.end()]);
}
