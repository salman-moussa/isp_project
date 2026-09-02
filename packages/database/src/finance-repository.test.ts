import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { VerifiedTenantId } from '@isp/contracts';
import type { Database } from './client.js';
import { allocatePayment, reverseInvoice } from './finance-repository.js';

describe('finance repository query safety', () => {
  it('binds a malicious reversal id as data rather than SQL text', async () => {
    const compiled: ReturnType<PgDialect['sqlToQuery']>[] = [];
    const dialect = new PgDialect();
    const execute = vi.fn(async (statement: SQL) => {
      compiled.push(dialect.sqlToQuery(statement));
      return [];
    });
    const database = {
      transaction: async (work: (transaction: { execute: typeof execute }) => Promise<unknown>) =>
        work({ execute }),
    } as unknown as Database;
    const maliciousId = "00000000-0000-4000-8000-000000000001' OR true --";

    await expect(
      reverseInvoice(database, '00000000-0000-4000-8000-00000000000a' as VerifiedTenantId, {
        originalId: maliciousId,
        reversalNumber: 'INV-R-1',
        idempotencyKey: 'invoice-reversal-1',
        actorId: 'actor-a',
        postedAt: new Date('2026-08-11T10:00:00.000Z'),
        audit: {
          sessionId: 'session-a',
          action: 'tenant.invoice.reverse',
          requestId: 'request-a',
          ipAddress: '127.0.0.1',
          permission: 'tenant.invoice.reverse',
          reason: 'Authorized test reversal.',
        },
      }),
    ).rejects.toThrow('conflicts with the current posted balance');

    const lookup = compiled[1]!;
    expect(lookup.sql).not.toContain(maliciousId);
    expect(lookup.params).toContain(maliciousId);
  });

  it('keeps signed finance conflicts on the finance-specific API contract', async () => {
    const tenantId = '00000000-0000-4000-8000-00000000000a' as VerifiedTenantId;
    const dialect = new PgDialect();
    const execute = vi.fn(async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      if (query.sql.includes('operations_current_context')) return [{ tenant_id: tenantId }];
      if (query.sql.includes('INSERT INTO finance_payment_allocations')) {
        throw Object.assign(new Error('allocation exceeds an available balance'), {
          code: 'P4091',
        });
      }
      return [];
    });
    const database = {
      transaction: async (work: (transaction: { execute: typeof execute }) => Promise<unknown>) =>
        work({ execute }),
    } as unknown as Database;

    await expect(
      allocatePayment(database, tenantId, {
        paymentId: '00000000-0000-4000-8000-000000000001',
        invoiceId: '00000000-0000-4000-8000-000000000002',
        amountMinor: 51,
        currency: 'USD',
        idempotencyKey: 'signed-allocation-conflict',
        actorId: '00000000-0000-4000-8000-000000000003',
        postedAt: new Date('2026-08-11T10:00:00.000Z'),
        audit: {
          sessionId: 'session-a',
          action: 'tenant.payment.allocate',
          requestId: 'request-a',
          ipAddress: '127.0.0.1',
          permission: 'tenant.payment.post',
          reason: 'Authorized test allocation.',
        },
        authorization: {
          attestationText: '{}',
          signatureHex: '00',
        },
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_CONFLICT' });
  });
});
