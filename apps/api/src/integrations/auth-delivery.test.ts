import { randomBytes } from 'node:crypto';
import type { MessageDeliveryEvidence, StoredIntegrationDelivery } from '@isp/database';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthDeliveryUnavailableError,
  DatabaseAuthDeliveryAdapter,
  type AuthDeliveryStore,
} from './auth-delivery.js';
import type { IntegrationRuntime } from './runtime.js';
import { AesGcmSecretBox } from './secret-box.js';
import { SmtpError, type MailMessage, type SmtpConnectionOptions } from './smtp-client.js';

function harness(options: { smtp?: boolean; failSend?: boolean } = {}) {
  const secretBox = new AesGcmSecretBox(randomBytes(32), 'integration-1');
  const stored: StoredIntegrationDelivery = {
    kind: 'smtp',
    version: 3,
    config: {
      host: 'smtp.example.test',
      port: 465,
      security: 'tls',
      username: 'mailer',
      fromAddress: 'noreply@example.test',
      fromName: 'Orvex ISP',
    },
    secretCiphertext: secretBox.seal({ password: 'mail-pass' }),
    cipherKeyId: 'integration-1',
    protectedFields: ['password'],
  };
  const otp = new Map<
    string,
    { digest: string; expiresAt: Date; attempts: number; consumed: boolean }
  >();
  const deliveries: MessageDeliveryEvidence[] = [];
  const sendMail = vi.fn<
    (
      options: SmtpConnectionOptions,
      message: MailMessage,
    ) => Promise<{
      messageId: string;
      response: string;
    }>
  >(async () => {
    if (options.failSend) throw new SmtpError('SMTP_CONNECT', 'down');
    return { messageId: '<m@example.test>', response: '250 ok' };
  });
  const runtime: IntegrationRuntime = {
    secretBox,
    transports: {
      sendMail,
      verifyMail: vi.fn(),
      sendSms: vi.fn(),
      sendWhatsapp: vi.fn(),
    },
    production: true,
  };
  const store: AuthDeliveryStore = {
    readIntegration: async () => (options.smtp === false ? null : stored),
    readTarget: async (userId) =>
      userId === 'user-1'
        ? { userId, email: 'maya@example.test', displayName: 'Maya', accountKind: 'tenant' }
        : userId === 'admin-1'
          ? { userId, email: 'admin@example.test', displayName: 'Admin', accountKind: 'platform' }
          : null,
    storeOtp: async (challengeId, digest, expiresAt) => {
      otp.set(challengeId, { digest, expiresAt, attempts: 0, consumed: false });
    },
    verifyOtp: async (challengeId, digest, now, maximumAttempts) => {
      const entry = otp.get(challengeId);
      if (!entry || entry.consumed || entry.expiresAt <= now || entry.attempts >= maximumAttempts)
        return false;
      if (entry.digest === digest) {
        entry.consumed = true;
        return true;
      }
      entry.attempts += 1;
      return false;
    },
    recordDelivery: async (evidence) => {
      deliveries.push(evidence);
    },
  };
  const adapter = new DatabaseAuthDeliveryAdapter(store, {
    runtime,
    digestSecret: randomBytes(32),
    webUrls: { platform: 'https://isp.example.test/control', tenant: 'https://isp.example.test' },
    now: () => new Date('2026-09-07T10:00:00.000Z'),
  });
  return { adapter, sendMail, deliveries, otp };
}

describe('DatabaseAuthDeliveryAdapter', () => {
  it('emails a one-time code, stores only its digest and verifies it once', async () => {
    const { adapter, sendMail, deliveries, otp } = harness();
    const challengeId = '11111111-1111-4111-8111-111111111111';
    const started = await adapter.start({
      userId: 'user-1',
      challengeId,
      expiresAt: new Date('2026-09-07T10:05:00.000Z'),
    });
    expect(started).toEqual({ adapterReference: challengeId });
    const message = sendMail.mock.calls[0]?.[1] as { to: string; text: string; subject: string };
    const options = sendMail.mock.calls[0]?.[0] as {
      password?: string;
      requireTlsForAuth?: boolean;
    };
    expect(message.to).toBe('maya@example.test');
    expect(options.password).toBe('mail-pass');
    expect(options.requireTlsForAuth).toBe(true);
    const code = /code is: (\d{6})/u.exec(message.text)?.[1];
    expect(code).toMatch(/^\d{6}$/u);
    expect(message.subject).toContain(code);
    expect(otp.get(challengeId)?.digest).not.toContain(code);
    expect(deliveries).toEqual([
      expect.objectContaining({
        purpose: 'otp',
        channel: 'smtp',
        recipientMasked: 'm***@example.test',
        status: 'sent',
        userId: 'user-1',
      }),
    ]);
    expect(await adapter.verify({ adapterReference: challengeId, code: '000000' })).toBe(false);
    expect(await adapter.verify({ adapterReference: challengeId, code: code! })).toBe(true);
    expect(await adapter.verify({ adapterReference: challengeId, code: code! })).toBe(false);
  });

  it('fails closed when SMTP is not configured or delivery fails, recording the failure', async () => {
    const unconfigured = harness({ smtp: false });
    await expect(
      unconfigured.adapter.start({ userId: 'user-1', challengeId: 'c', expiresAt: new Date() }),
    ).rejects.toBeInstanceOf(AuthDeliveryUnavailableError);
    const failing = harness({ failSend: true });
    await expect(
      failing.adapter.deliver({
        userId: 'user-1',
        email: 'maya@example.test',
        token: 'tok',
        expiresAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(AuthDeliveryUnavailableError);
    expect(failing.deliveries).toEqual([
      expect.objectContaining({ purpose: 'recovery', status: 'failed', errorCode: 'SMTP_CONNECT' }),
    ]);
  });

  it('links recovery and invitation mail to the right web application', async () => {
    const { adapter, sendMail } = harness();
    await adapter.deliver({
      userId: 'admin-1',
      email: 'admin@example.test',
      token: 'recovery-token',
      expiresAt: new Date('2026-09-07T11:00:00.000Z'),
    });
    await adapter.deliverInvitation({
      invitationId: 'inv',
      tenantId: 'tenant-1',
      email: 'new@example.test',
      displayName: 'New Staff',
      token: 'invite-token',
      expiresAt: new Date('2026-09-08T11:00:00.000Z'),
    });
    const recovery = sendMail.mock.calls[0]?.[1] as { text: string };
    const invitation = sendMail.mock.calls[1]?.[1] as { text: string; to: string };
    expect(recovery.text).toContain('https://isp.example.test/control/#/recovery/recovery-token');
    expect(invitation.text).toContain('https://isp.example.test/#/staff-invitation/invite-token');
    expect(invitation.to).toBe('new@example.test');
  });

  it('delegates to the remote fallback only while SMTP is absent', async () => {
    const fallback = {
      start: vi.fn(async () => ({ adapterReference: 'ext-1' })),
      verify: vi.fn(async () => true),
      deliver: vi.fn(async () => undefined),
      deliverInvitation: vi.fn(async () => undefined),
    };
    const { adapter } = harness({ smtp: false });
    const withFallback = new DatabaseAuthDeliveryAdapter(
      {
        readIntegration: async () => null,
        readTarget: async () => null,
        storeOtp: async () => undefined,
        verifyOtp: async () => false,
        recordDelivery: async () => undefined,
      },
      {
        runtime: {
          secretBox: new AesGcmSecretBox(randomBytes(32), 'k-1'),
          transports: adapter as never,
          production: true,
        },
        digestSecret: randomBytes(32),
        webUrls: { platform: 'https://p.test', tenant: 'https://t.test' },
        fallback,
      },
    );
    const started = await withFallback.start({
      userId: 'u',
      challengeId: 'c',
      expiresAt: new Date(),
    });
    expect(started.adapterReference).toBe('remote:ext-1');
    expect(await withFallback.verify({ adapterReference: 'remote:ext-1', code: '123456' })).toBe(
      true,
    );
    expect(fallback.verify).toHaveBeenCalledWith({ adapterReference: 'ext-1', code: '123456' });
  });
});
