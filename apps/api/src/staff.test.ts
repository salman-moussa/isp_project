import { describe, expect, it, vi } from 'vitest';
import {
  StaffInvitationInvalidError,
  TenantStaffService,
  type TenantStaffRepository,
} from './staff.js';

const tenantId = '00000000-0000-4000-8000-00000000000a' as never;
const now = new Date('2026-08-29T08:00:00.000Z');

function repository(): TenantStaffRepository {
  return {
    read: async () => [],
    readInvitations: async () => [],
    createInvitation: vi.fn(async (input) => ({
      invitationId: input.invitationId,
      replayed: false,
    })),
    acceptInvitation: vi.fn(async () => ({
      outcome: 'created' as const,
      tenantId,
      userId: '00000000-0000-4000-8000-000000000011',
    })),
    updateMembership: vi.fn(async () => 2),
    revokeInvitation: vi.fn(async () => true),
  };
}

describe('TenantStaffService', () => {
  it('creates and delivers an opaque one-time invitation using a canonical role', async () => {
    const repo = repository();
    let deliveredToken = '';
    const deliverInvitation = vi.fn(
      async (input: { readonly token: string }) => void (deliveredToken = input.token),
    );
    const service = new TenantStaffService(repo, { deliverInvitation }, Buffer.alloc(32, 7), {
      now: () => now,
    });

    const result = await service.invite(
      tenantId,
      {
        email: ' Collector@Example.com ',
        displayName: ' Field Collector ',
        roleKey: 'collector',
        scope: { routeIds: ['00000000-0000-4000-8000-000000000099'] },
      },
      {
        actorId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        requestId: 'request-1',
        reason: 'Approved collector onboarding',
        idempotencyKey: 'collector-onboarding-1',
      },
    );

    expect(result).toMatchObject({ status: 'pending', replayed: false });
    const createInput = vi.mocked(repo.createInvitation).mock.calls[0]![0];
    expect(createInput).toMatchObject({
      email: 'collector@example.com',
      displayName: 'Field Collector',
      roleKey: 'collector',
    });
    expect(createInput.tokenDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(deliveredToken).toHaveLength(43);
    expect(deliveredToken).not.toBe(createInput.tokenDigest);
  });

  it('denies a collector without a route scope before persistence', async () => {
    const repo = repository();
    const service = new TenantStaffService(
      repo,
      { deliverInvitation: async () => undefined },
      Buffer.alloc(32, 9),
      { now: () => now },
    );
    await expect(
      service.invite(
        tenantId,
        {
          email: 'collector@example.com',
          displayName: 'Collector',
          roleKey: 'collector',
          scope: {},
        },
        {
          actorId: '00000000-0000-4000-8000-000000000001',
          sessionId: '00000000-0000-4000-8000-000000000002',
          requestId: 'request-2',
          reason: 'Approved collector onboarding',
          idempotencyKey: 'collector-onboarding-2',
        },
      ),
    ).rejects.toBeInstanceOf(StaffInvitationInvalidError);
    expect(repo.createInvitation).not.toHaveBeenCalled();
  });

  it('passes invitation revocation through the guarded repository with actor evidence', async () => {
    const repo = repository();
    const service = new TenantStaffService(
      repo,
      { deliverInvitation: async () => undefined },
      Buffer.alloc(32, 3),
      { now: () => now },
    );
    await expect(
      service.revokeInvitation(tenantId, '00000000-0000-4000-8000-000000000099', {
        actorId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        requestId: 'request-revoke',
        reason: 'Invitation issued to the wrong address',
      }),
    ).resolves.toBe(true);
    expect(repo.revokeInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        invitationId: '00000000-0000-4000-8000-000000000099',
        now,
      }),
    );
  });
});
