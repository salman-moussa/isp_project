import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { VerifiedTenantId } from '@isp/contracts';
import type { Database } from './client.js';
import { reverseInvoice } from './finance-repository.js';

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
});
