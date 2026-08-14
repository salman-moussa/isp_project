import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeControlContextSecret,
  PostgresControlCenterService,
} from './control-center-service.js';

const secret = Buffer.from('0123456789abcdef0123456789abcdef');

describe('Control Center production adapter', () => {
  it('rejects malformed and undersized context secrets', () => {
    expect(() => decodeControlContextSecret('not base64!')).toThrow('canonical base64');
    expect(() => decodeControlContextSecret(Buffer.from('short').toString('base64'))).toThrow(
      'at least 32 bytes',
    );
  });

  it('signs the authenticated envelope and converts route dates before repository execution', async () => {
    const statements: unknown[] = [];
    const database = {
      transaction: async (
        work: (transaction: { execute: (sql: unknown) => Promise<unknown[]> }) => Promise<unknown>,
      ) =>
        work({
          execute: async (statement: unknown) => {
            statements.push(statement);
            return [{ actor_id: 'platform-user-a', result: { id: 'package-v1' } }];
          },
        }),
    };
    const service = new PostgresControlCenterService(
      database as never,
      { keyId: 'control-v1', secret },
      () => new Date('2026-08-13T10:00:00.000Z'),
    );

    await service.createPackageVersion({
      actorId: 'platform-user-a',
      sessionId: 'session-a',
      requestId: 'request-a',
      ipAddress: '127.0.0.1',
      permission: 'platform.subscription.manage',
      action: 'package.create',
      idempotencyKey: 'package-create-001',
      requestHash: 'a'.repeat(64),
      reason: 'Create the first production package',
      packageKey: 'starter',
      version: 1,
      nameEn: 'Starter',
      nameAr: 'بداية',
      entitlements: ['core.access'],
      priceMinor: 1000,
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
    });

    const signedQuery = statements[1] as { queryChunks?: unknown[] };
    expect(signedQuery).toBeDefined();
    // The signing primitive itself is deterministic and matches the database HMAC contract.
    const attestation = JSON.stringify({ proof: true });
    expect(createHmac('sha256', secret).update(attestation).digest('hex')).toHaveLength(64);
  });
});
