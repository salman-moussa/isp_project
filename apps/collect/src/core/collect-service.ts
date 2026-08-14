import type { Clock, IdGenerator, PayloadHasher, ReceiptPrinter } from './adapters.js';
import {
  CollectAccessError,
  CollectValidationError,
  type Assignment,
  type CollectState,
  type CollectorSession,
  type Currency,
  type DeviceRegistration,
  type LocalPayment,
  type OutboxOperation,
  type PaymentInput,
  type PaymentMethod,
  type ReconciliationDraft,
  type ReconciliationLine,
} from './model.js';
import type { CollectStore } from './storage.js';

const CLOCK_SKEW_EVIDENCE_MS = 5 * 60 * 1000;

function requireAccess(
  state: CollectState,
  now: Date,
): { device: DeviceRegistration; session: CollectorSession } {
  const device = state.device;
  const session = state.session;
  if (device?.status === 'revoked') throw new CollectAccessError('revoked');
  if (device?.status === 'reauth_required') throw new CollectAccessError('reauth_required');
  if (device === undefined || session === undefined)
    throw new CollectAccessError('reauth_required');
  if (
    session.deviceId !== device.deviceId ||
    session.collectorId !== device.collectorId ||
    session.tenantId !== device.tenantId
  ) {
    throw new CollectAccessError('scope_denied');
  }
  if (Date.parse(session.expiresAt) <= now.getTime())
    throw new CollectAccessError('session_expired');
  if (Date.parse(device.cachedAssignmentsExpireAt) <= now.getTime())
    throw new CollectAccessError('cache_expired');
  return { device, session };
}

function validatePayment(input: PaymentInput): void {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new CollectValidationError(
      'amountMinor',
      'Payment amount must be a positive integer in currency minor units.',
    );
  }
  if (input.currency !== 'USD' && input.currency !== 'LBP') {
    throw new CollectValidationError('currency', 'An explicit USD or LBP currency is required.');
  }
  if (!['cash', 'omt', 'whish', 'bank_transfer'].includes(input.method)) {
    throw new CollectValidationError('method', 'An explicit supported payment method is required.');
  }
  if (input.allocationInvoiceId.trim() === '') {
    throw new CollectValidationError('allocationInvoiceId', 'Payment allocation is required.');
  }
}

function businessDay(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

export class CollectService {
  public constructor(
    private readonly store: CollectStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly hasher: PayloadHasher,
  ) {}

  public async installBootstrap(input: {
    device: DeviceRegistration;
    session: CollectorSession;
    assignments: readonly Assignment[];
  }): Promise<void> {
    if (
      input.device.deviceId !== input.session.deviceId ||
      input.device.tenantId !== input.session.tenantId
    ) {
      throw new CollectAccessError('scope_denied');
    }
    if (
      input.assignments.some(
        (assignment) => assignment.assignmentVersion > input.session.assignmentContextVersion,
      )
    ) {
      throw new CollectAccessError('scope_denied');
    }
    await this.store.transaction((state) => {
      state.device = input.device;
      state.session = input.session;
      state.assignments = structuredClone([...input.assignments]);
      delete state.lockedReason;
    });
  }

  public async listAssignedRoutes(): Promise<readonly Assignment[]> {
    const state = await this.store.read();
    requireAccess(state, this.clock.now());
    return state.assignments;
  }

  public async recordPayment(input: PaymentInput): Promise<LocalPayment> {
    validatePayment(input);
    const operationId = this.ids.next();
    const localPaymentId = this.ids.next();
    return this.store.transaction(async (state) => {
      const { device, session } = requireAccess(state, this.clock.now());
      const assignment = state.assignments.find((item) => item.assignmentId === input.assignmentId);
      if (
        assignment === undefined ||
        assignment.assignmentVersion > session.assignmentContextVersion
      ) {
        throw new CollectAccessError('scope_denied');
      }
      if (assignment.currency !== input.currency) {
        throw new CollectValidationError(
          'currency',
          'Payment currency must match the selected assigned invoice.',
        );
      }
      const sequence = state.nextLocalSequence++;
      const payload = {
        localPaymentId,
        assignmentId: input.assignmentId,
        allocationInvoiceId: input.allocationInvoiceId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        method: input.method,
        note: input.note ?? null,
        proofReference: input.proofReference ?? null,
        occurredAtDevice: input.occurredAtDevice,
      } as const;
      const payloadHash = await this.hasher.hash(payload);
      const provisionalReceiptNumber = `${device.deviceId.slice(-6).toUpperCase()}-${businessDay(this.clock.now())}-${String(sequence).padStart(4, '0')}-${operationId.slice(-6).toUpperCase()}`;
      const payment: LocalPayment = {
        localPaymentId,
        operationId,
        assignmentId: input.assignmentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        method: input.method,
        allocationInvoiceId: input.allocationInvoiceId,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.proofReference === undefined ? {} : { proofReference: input.proofReference }),
        provisionalReceiptNumber,
        occurredAtDevice: input.occurredAtDevice,
        clockSkewSuspected:
          Math.abs(Date.parse(input.occurredAtDevice) - this.clock.now().getTime()) >
          CLOCK_SKEW_EVIDENCE_MS,
        localSequence: sequence,
        syncStatus: 'pending',
      };
      const operation: OutboxOperation = {
        operationId,
        idempotencyKey: operationId,
        type: 'payment.create',
        schemaVersion: 1,
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        collectorId: device.collectorId,
        assignmentContextVersion: session.assignmentContextVersion,
        payload,
        payloadHash,
        dependencies: [],
        createdLocalSequence: sequence,
        occurredAtDevice: input.occurredAtDevice,
        status: 'pending',
        attemptCount: 0,
      };
      state.payments.push(payment);
      state.outbox.push(operation);
      return payment;
    });
  }

  public async printReceipt(
    localPaymentId: string,
    printer: ReceiptPrinter,
  ): Promise<'printed' | 'failed' | 'disconnected'> {
    const state = await this.store.read();
    const { device, session } = requireAccess(state, this.clock.now());
    const payment = state.payments.find((item) => item.localPaymentId === localPaymentId);
    if (payment === undefined)
      throw new CollectValidationError('localPaymentId', 'Payment was not found.');
    const assignment = state.assignments.find((item) => item.assignmentId === payment.assignmentId);
    if (assignment === undefined) throw new CollectAccessError('scope_denied');
    const result = await printer.print({
      provisionalReceiptNumber: payment.provisionalReceiptNumber,
      ...(payment.canonicalReceiptNumber === undefined
        ? {}
        : { canonicalReceiptNumber: payment.canonicalReceiptNumber }),
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      subscriberName: assignment.subscriberName,
    });
    await this.store.transaction(async (draft) => {
      requireAccess(draft, this.clock.now());
      const operationId = this.ids.next();
      const sequence = draft.nextLocalSequence++;
      const payload = {
        localPaymentId,
        receiptNumber: payment.provisionalReceiptNumber,
        outcome: result.outcome,
      } as const;
      draft.printAttempts.push({
        attemptId: this.ids.next(),
        operationId,
        localPaymentId,
        attemptedAt: this.clock.now().toISOString(),
        outcome: result.outcome,
        ...(result.outcome === 'printed' ? {} : { failureCode: result.code }),
      });
      draft.outbox.push({
        operationId,
        idempotencyKey: operationId,
        type: 'receipt.print.audit',
        schemaVersion: 1,
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        collectorId: device.collectorId,
        assignmentContextVersion: session.assignmentContextVersion,
        payload,
        payloadHash: await this.hasher.hash(payload),
        dependencies: [payment.operationId],
        createdLocalSequence: sequence,
        occurredAtDevice: this.clock.now().toISOString(),
        status: 'pending',
        attemptCount: 0,
      });
    });
    return result.outcome;
  }

  public async saveReconciliationDraft(input: {
    reconciliationId: string;
    businessDate: string;
    declared: readonly {
      currency: Currency;
      method: PaymentMethod;
      declaredMinor: number;
      denominationCounts?: Readonly<Record<string, number>>;
      handoverReference?: string;
      proofReference?: string;
    }[];
    note?: string;
  }): Promise<ReconciliationDraft> {
    return this.store.transaction((state) => {
      requireAccess(state, this.clock.now());
      const lines: ReconciliationLine[] = input.declared.map((declared) => {
        if (!Number.isSafeInteger(declared.declaredMinor) || declared.declaredMinor < 0) {
          throw new CollectValidationError(
            'declaredMinor',
            'Declared amount must be a non-negative integer.',
          );
        }
        const expectedMinor = state.payments
          .filter(
            (payment) =>
              payment.currency === declared.currency &&
              payment.method === declared.method &&
              payment.syncStatus !== 'rejected',
          )
          .reduce((sum, payment) => sum + payment.amountMinor, 0);
        return {
          currency: declared.currency,
          method: declared.method,
          expectedMinor,
          declaredMinor: declared.declaredMinor,
          differenceMinor: declared.declaredMinor - expectedMinor,
          ...(declared.denominationCounts === undefined
            ? {}
            : { denominationCounts: declared.denominationCounts }),
          ...(declared.handoverReference === undefined
            ? {}
            : { handoverReference: declared.handoverReference }),
          ...(declared.proofReference === undefined
            ? {}
            : { proofReference: declared.proofReference }),
        };
      });
      const requiresManagerApproval = lines.some((line) => line.differenceMinor !== 0);
      if (requiresManagerApproval && (input.note?.trim().length ?? 0) < 8) {
        throw new CollectValidationError(
          'note',
          'A discrepancy note of at least eight characters is required.',
        );
      }
      const draft: ReconciliationDraft = {
        reconciliationId: input.reconciliationId,
        businessDate: input.businessDate,
        lines,
        ...(input.note === undefined ? {} : { note: input.note }),
        requiresManagerApproval,
        status: 'draft',
      };
      const index = state.reconciliations.findIndex(
        (item) => item.reconciliationId === input.reconciliationId,
      );
      if (index < 0) state.reconciliations.push(draft);
      else state.reconciliations[index] = draft;
      return draft;
    });
  }

  public async submitReconciliation(reconciliationId: string): Promise<ReconciliationDraft> {
    const existing = (await this.store.read()).reconciliations.find(
      (item) => item.reconciliationId === reconciliationId,
    );
    if (existing?.operationId !== undefined) return existing;
    const operationId = this.ids.next();
    return this.store.transaction(async (state) => {
      const { device, session } = requireAccess(state, this.clock.now());
      const index = state.reconciliations.findIndex(
        (item) => item.reconciliationId === reconciliationId,
      );
      const draft = state.reconciliations[index];
      if (draft === undefined)
        throw new CollectValidationError('reconciliationId', 'Reconciliation draft was not found.');
      if (draft.operationId !== undefined) return draft;
      const sequence = state.nextLocalSequence++;
      const payload = {
        reconciliationId,
        businessDate: draft.businessDate,
        lines: draft.lines,
        note: draft.note ?? null,
      } as const;
      const submitted: ReconciliationDraft = { ...draft, operationId, status: 'pending' };
      state.reconciliations[index] = submitted;
      state.outbox.push({
        operationId,
        idempotencyKey: operationId,
        type: 'reconciliation.submit',
        schemaVersion: 1,
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        collectorId: device.collectorId,
        assignmentContextVersion: session.assignmentContextVersion,
        payload,
        payloadHash: await this.hasher.hash(payload),
        dependencies: state.payments.map((payment) => payment.operationId),
        createdLocalSequence: sequence,
        occurredAtDevice: this.clock.now().toISOString(),
        status: 'pending',
        attemptCount: 0,
      });
      return submitted;
    });
  }
}
