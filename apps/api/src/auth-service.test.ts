import { describe, expect, it, vi } from 'vitest';
import { AuthService, type AuthRepositoryPort } from './auth-service.js';

function repository() {
  const createMfaChallenge = vi.fn(async () => undefined);
  const appendSecurityEvent = vi.fn(async () => undefined);
  const port: AuthRepositoryPort = {
    findPrincipalByEmail: async () => null,
    readAuthorization: async () => ({
      audience: 'tenant',
      tenantId: '00000000-0000-4000-8000-00000000000a',
      authorizationVersion: 3,
      permissions: ['tenant.user.administer'],
    }),
    createMfaChallenge,
    readMfaChallenge: async () => null,
    consumeMfaChallenge: async () => null,
    recordMfaFailure: async () => undefined,
    createSession: async () => undefined,
    rotateRefresh: async () => ({ outcome: 'invalid' }),
    listSessions: async () => [],
    revokeSession: async () => false,
    revokeAllSessions: async () => 0,
    createRecoveryToken: async () => false,
    completeRecovery: async () => false,
    appendSecurityEvent,
  };
  return { port, createMfaChallenge, appendSecurityEvent };
}

describe('AuthService MFA step-up', () => {
  it('creates a short-lived challenge from canonical current authorization', async () => {
    const { port: repo, createMfaChallenge, appendSecurityEvent } = repository();
    const start = vi.fn(async () => ({ adapterReference: 'provider-challenge-1' }));
    const now = new Date('2026-08-29T08:00:00.000Z');
    const service = new AuthService(
      repo,
      { issue: async () => 'unused' },
      { start, verify: async () => false },
      { deliver: async () => undefined },
      { tokenDigestSecret: Buffer.alloc(32, 4), now: () => now },
    );

    const result = await service.startMfaStepUp(
      {
        userId: '00000000-0000-4000-8000-000000000001',
        audience: 'tenant',
        tenantId: '00000000-0000-4000-8000-00000000000a',
      },
      { requestId: 'step-up-1' },
    );

    expect(result.status).toBe('mfa_required');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date('2026-08-29T08:05:00.000Z') }),
    );
    expect(createMfaChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '00000000-0000-4000-8000-00000000000a',
        adapterReference: 'provider-challenge-1',
      }),
    );
    expect(appendSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.mfa.step_up', result: 'allowed' }),
    );
  });
});
