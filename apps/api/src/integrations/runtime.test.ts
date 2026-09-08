import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MessagingError } from './messaging.js';
import {
  IntegrationValidationError,
  maskRecipient,
  performIntegrationTest,
  prepareIntegrationConfiguration,
  type IntegrationRuntime,
} from './runtime.js';
import { AesGcmSecretBox } from './secret-box.js';
import { SmtpError } from './smtp-client.js';

function runtime(overrides: Partial<IntegrationRuntime['transports']> = {}, production = true) {
  const secretBox = new AesGcmSecretBox(randomBytes(32), 'integration-1');
  const transports: IntegrationRuntime['transports'] = {
    sendMail: vi.fn(async () => ({ messageId: '<id@test>', response: '250 queued' })),
    verifyMail: vi.fn(async () => ({
      greeting: '',
      extensions: [],
      authenticated: true,
      tls: true,
    })),
    sendSms: vi.fn(async () => ({ providerReference: 'SM1' })),
    sendWhatsapp: vi.fn(async () => ({ providerReference: 'WA1' })),
    ...overrides,
  };
  return { secretBox, transports, production } satisfies IntegrationRuntime;
}

const smtpConfig = {
  host: 'smtp.example.test',
  port: 587,
  security: 'starttls',
  username: 'mailer',
  fromAddress: 'noreply@example.test',
};

describe('integration runtime', () => {
  it('seals secrets, records their field names and a keyed fingerprint', () => {
    const current = runtime();
    const prepared = prepareIntegrationConfiguration(current, {
      kind: 'smtp',
      config: smtpConfig,
      secrets: { password: 'p@ss' },
      keepSecrets: false,
      active: true,
    });
    expect(prepared.protectedFields).toEqual(['password']);
    expect(prepared.cipherKeyId).toBe('integration-1');
    expect(prepared.cipherFingerprint).toBe(current.secretBox.fingerprint({ password: 'p@ss' }));
    expect(current.secretBox.open(prepared.secretCiphertext!, 'integration-1')).toEqual({
      password: 'p@ss',
    });
    expect(JSON.stringify(prepared.config)).not.toContain('p@ss');
  });

  it('requires credentials unless the stored ones are kept, and refuses cleartext auth in production', () => {
    const current = runtime();
    expect(() =>
      prepareIntegrationConfiguration(current, {
        kind: 'sms',
        config: {
          provider: 'twilio',
          accountSid: `AC${'a'.repeat(32)}`,
          fromNumber: '+96170000000',
        },
        keepSecrets: false,
        active: true,
      }),
    ).toThrow(IntegrationValidationError);
    expect(
      prepareIntegrationConfiguration(current, {
        kind: 'smtp',
        config: smtpConfig,
        keepSecrets: true,
        active: true,
        expectedVersion: 2,
      }),
    ).toMatchObject({ keepSecrets: true, protectedFields: [], expectedVersion: 2 });
    expect(() =>
      prepareIntegrationConfiguration(current, {
        kind: 'smtp',
        config: { ...smtpConfig, security: 'none' },
        secrets: { password: 'x' },
        keepSecrets: false,
        active: true,
      }),
    ).toThrow('TLS or STARTTLS');
    expect(
      prepareIntegrationConfiguration(runtime({}, false), {
        kind: 'smtp',
        config: { ...smtpConfig, security: 'none' },
        secrets: { password: 'x' },
        keepSecrets: false,
        active: true,
      }).protectedFields,
    ).toEqual(['password']);
  });

  it('performs an SMTP test with the opened credential and reports sanitized outcomes', async () => {
    const current = runtime();
    const sealed = current.secretBox.seal({ password: 'p@ss' });
    const stored = {
      kind: 'smtp' as const,
      version: 1,
      config: smtpConfig,
      secretCiphertext: sealed,
      cipherKeyId: 'integration-1',
      protectedFields: ['password'],
    };
    const content = { mail: { subject: 's', text: 't', html: '<p>t</p>' }, text: 't' };
    const passed = await performIntegrationTest(current, stored, 'ops@example.test', content);
    expect(passed).toMatchObject({
      status: 'passed',
      recipientMasked: 'o***@example.test',
      providerReference: '<id@test>',
    });
    expect(current.transports.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mailer', password: 'p@ss', requireTlsForAuth: true }),
      expect.objectContaining({ to: 'ops@example.test' }),
    );

    const failing = runtime({
      sendMail: vi.fn(async () => {
        throw new SmtpError('SMTP_AUTH', '535 denied');
      }),
    });
    const failed = await performIntegrationTest(
      failing,
      { ...stored, secretCiphertext: failing.secretBox.seal({ password: 'p' }) },
      'ops@example.test',
      content,
    );
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'SMTP_AUTH',
      message: '535 denied',
    });

    await expect(
      performIntegrationTest(current, stored, '+96171111111', content),
    ).rejects.toBeInstanceOf(IntegrationValidationError);
  });

  it('routes SMS and WhatsApp tests to the configured provider', async () => {
    const rejected = runtime({
      sendWhatsapp: vi.fn(async () => {
        throw new MessagingError('PROVIDER_REJECTED', 'bad number');
      }),
    });
    const content = { mail: { subject: 's', text: 't', html: '' }, text: 'test' };
    const sms = await performIntegrationTest(
      rejected,
      {
        kind: 'sms',
        version: 1,
        config: { provider: 'http_json', endpointUrl: 'https://gateway.test/send' },
        secretCiphertext: rejected.secretBox.seal({ authToken: 'bearer-token-1' }),
        cipherKeyId: 'integration-1',
        protectedFields: ['authToken'],
      },
      '+96171111111',
      content,
    );
    expect(sms).toMatchObject({
      status: 'passed',
      providerReference: 'SM1',
      recipientMasked: '+961****111',
    });
    const whatsapp = await performIntegrationTest(
      rejected,
      {
        kind: 'whatsapp',
        version: 1,
        config: { provider: 'meta_cloud', phoneNumberId: '12345', apiVersion: 'v20.0' },
        secretCiphertext: rejected.secretBox.seal({ authToken: 'meta-token-12345' }),
        cipherKeyId: 'integration-1',
        protectedFields: ['authToken'],
      },
      '+96171111111',
      content,
    );
    expect(whatsapp).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_REJECTED' });
  });

  it('masks recipients for evidence', () => {
    expect(maskRecipient('someone@example.test')).toBe('s***@example.test');
    expect(maskRecipient('+96171234567')).toBe('+961****567');
    expect(maskRecipient('unknown')).toBe('un***');
  });
});
