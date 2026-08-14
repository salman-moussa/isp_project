import { describe, expect, it } from 'vitest';
import { signControlContext } from './context-authority.js';

describe('Control Center context authority', () => {
  it('signs actor, session, permission, MFA and request identity deterministically', () => {
    const secret = new Uint8Array(32).fill(7);
    const context = signControlContext(
      {
        keyId: 'control-v1',
        actorId: 'manager-b',
        sessionId: 'session-b',
        permission: 'platform.subscription.manage',
        action: 'transition.approve',
        requestId: 'request-b',
        requestHash: 'a'.repeat(64),
        idempotencyKey: 'approve-001',
        ipAddress: '127.0.0.1',
        reason: 'Reviewed evidence',
        mfaVerifiedAt: '2026-08-11T11:55:00.000Z',
        expiresAt: '2026-08-11T12:01:00.000Z',
      },
      secret,
    );
    expect(context.attestationText).toContain('"actorId":"manager-b"');
    expect(context.attestationText).toContain('"sessionId":"session-b"');
    expect(context.signatureHex).toMatch(/^[0-9a-f]{64}$/);
    expect(
      signControlContext(
        {
          keyId: 'control-v1',
          actorId: 'manager-c',
          sessionId: 'session-b',
          permission: 'platform.subscription.manage',
          action: 'transition.approve',
          requestId: 'request-b',
          requestHash: 'a'.repeat(64),
          idempotencyKey: 'approve-001',
          ipAddress: '127.0.0.1',
          reason: 'Reviewed evidence',
          mfaVerifiedAt: '2026-08-11T11:55:00.000Z',
          expiresAt: '2026-08-11T12:01:00.000Z',
        },
        secret,
      ).signatureHex,
    ).not.toBe(context.signatureHex);
  });
});
