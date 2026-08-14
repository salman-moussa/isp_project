import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeEmailProvider, FakeOtpProvider, WhatsAppDeepLinkProvider } from './communications.js';
import { assertNoPlaintextSecrets, createProviderConfiguration } from './config.js';
import {
  FakeBluetoothPrinter,
  FakeDnsProvider,
  FakeMalwareScanner,
  FakeMapsProvider,
  FakeS3ObjectStorage,
  FakeSslProvider,
} from './facilities.js';
import {
  FakeBankImportProvider,
  FakeCardPaymentProvider,
  FakeMoneyTransferProvider,
  ManualMoneyTransferProvider,
} from './payments.js';
import { ProviderRegistry } from './registry.js';
import { ProviderExecutor } from './resilience.js';
import {
  InMemoryProviderDeadLetterStore,
  ProviderError,
  type ProviderKind,
  type ProviderRequestContext,
} from './types.js';
import {
  InMemoryWebhookEventStore,
  InMemoryWebhookReplayStore,
  storeVerifiedWebhook,
  verifyAndClaimWebhook,
} from './webhook.js';

const context: ProviderRequestContext = {
  tenantId: 'tenant-1',
  requestId: 'request-1',
  idempotencyKey: 'idem-1',
  deadline: new Date('2026-08-13T08:05:00.000Z'),
};

function configuration(kind: ProviderKind, mode: 'manual' | 'fake' = 'fake') {
  return createProviderConfiguration({
    providerId: `${kind}-primary`,
    kind,
    mode,
    enabled: true,
    timeoutMs: 1_000,
    maxAttempts: 3,
    featureFlags: { enabled: true },
  });
}

describe('provider configuration contract (REQ-INT-001)', () => {
  it('requires secret references and TLS for live providers', () => {
    expect(() =>
      createProviderConfiguration({
        providerId: 'live-payment',
        kind: 'online_payment',
        mode: 'live',
        enabled: true,
        endpoint: 'http://provider.example',
        secretReferences: { apiKey: 'not-a-secret-reference' },
      }),
    ).toThrow(/secret-manager reference/);
  });

  it('rejects plaintext secret-shaped nested configuration', () => {
    expect(() => assertNoPlaintextSecrets({ adapter: { apiKey: 'plaintext' } })).toThrow(
      /forbidden/,
    );
    expect(() =>
      assertNoPlaintextSecrets({ adapter: { apiKeyReference: 'secret://provider/key' } }),
    ).not.toThrow();
  });

  it('reports provider health, feature flags and activation status', async () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeMapsProvider(configuration('maps')));
    registry.register(new ManualMoneyTransferProvider(configuration('omt', 'manual')));
    expect(registry.featureEnabled('maps-primary', 'enabled')).toBe(true);
    expect((await registry.health(context)).map((item) => item.status)).toEqual([
      'healthy',
      'healthy',
    ]);
    expect(registry.activation()[1]?.liveAvailable).toBe(false);
  });
});

describe('payment and reconciliation provider contracts (REQ-INT-002)', () => {
  it('keeps OMT and Whish manual-first without inventing live APIs', async () => {
    for (const kind of ['omt', 'whish'] as const) {
      const provider = new ManualMoneyTransferProvider(configuration(kind, 'manual'));
      const result = await provider.submitEvidence(
        {
          externalReference: `${kind.toUpperCase()}-1234`,
          proofAttachmentId: 'attachment-1',
          amountMinor: 2_000,
          currency: 'USD',
          receivedAt: '2026-08-13T08:00:00.000Z',
        },
        context,
      );
      expect(result.state).toBe('pending_manual_review');
      expect(provider.activation().liveBlockedReason).toMatch(/official contract/);
    }
  });

  it('supplies deterministic fakes for OMT, POS, online and bank import', async () => {
    const omt = new FakeMoneyTransferProvider(configuration('omt'));
    expect(
      (
        await omt.submitEvidence(
          {
            externalReference: 'OMT-1',
            proofAttachmentId: 'proof-1',
            amountMinor: 100,
            currency: 'USD',
            receivedAt: '2026-08-13T08:00:00.000Z',
          },
          context,
        )
      ).state,
    ).toBe('verified');
    for (const kind of ['pos', 'online_payment'] as const) {
      const provider = new FakeCardPaymentProvider(configuration(kind));
      expect(
        (
          await provider.charge(
            {
              amountMinor: 1_500,
              currency: 'LBP',
              paymentMethodTokenReference: 'secret://tokens/fake-1',
            },
            context,
          )
        ).state,
      ).toBe('authorized');
    }
    const bank = new FakeBankImportProvider(configuration('bank_import'));
    await expect(
      bank.parse([
        { bookingDate: '2026-08-13', reference: 'row-1', amountMinor: 10, currency: 'USD' },
        { bookingDate: '2026-08-13', reference: 'row-1', amountMinor: 10, currency: 'USD' },
      ]),
    ).rejects.toThrow(/Duplicate/);
  });
});

describe('operational provider fake matrix (REQ-INT-003)', () => {
  it('covers maps, printer, S3/scanner, email/OTP, WhatsApp, DNS and SSL', async () => {
    expect(
      (await new FakeMapsProvider(configuration('maps')).geocode('Beirut', context)).precision,
    ).toBe('fake');

    const printer = new FakeBluetoothPrinter(configuration('bluetooth_printer'));
    expect(
      (await printer.print({ receiptId: 'receipt-1', content: new Uint8Array([1]), copies: 1 }))
        .printJobId,
    ).toContain('receipt-1');
    printer.setConnected(false);
    await expect(
      printer.print({ receiptId: 'receipt-2', content: new Uint8Array([1]), copies: 1 }),
    ).rejects.toMatchObject({ failureClass: 'unavailable' });

    const storage = new FakeS3ObjectStorage(configuration('object_storage'));
    await storage.put('tenant-1/document.pdf', new TextEncoder().encode('safe document'));
    expect(await storage.get('tenant-1/document.pdf')).toBeInstanceOf(Uint8Array);
    const scanner = new FakeMalwareScanner(configuration('malware_scanner'));
    expect(
      (await scanner.scan(new TextEncoder().encode('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))).verdict,
    ).toBe('infected');

    const email = new FakeEmailProvider(configuration('email'));
    expect(
      (await email.send({ to: 'staff@example.test', templateId: 'otp' }, context)).messageId,
    ).toContain('idem-1');
    const otp = new FakeOtpProvider(configuration('otp'));
    const challenge = await otp.issue('staff-1', context);
    expect(
      await otp.verify(
        challenge.challengeId,
        challenge.testCode,
        new Date('2026-08-13T08:01:00.000Z'),
      ),
    ).toBe(true);
    expect(
      await otp.verify(
        challenge.challengeId,
        challenge.testCode,
        new Date('2026-08-13T08:01:01.000Z'),
      ),
    ).toBe(false);

    const whatsapp = new WhatsAppDeepLinkProvider(configuration('whatsapp_deep_link'));
    const link = whatsapp.createShareLink({
      phoneE164: '+96171123456',
      documentUrl: new URL('https://docs.example.test/receipt-1'),
      message: 'Receipt',
    });
    expect(link.origin).toBe('https://wa.me');

    const dns = new FakeDnsProvider(configuration('dns'));
    expect(
      (
        await dns.apply(
          { recordType: 'A', name: 'isp.example', value: '192.0.2.1', ttlSeconds: 300 },
          context,
        )
      ).changeId,
    ).toContain('idem-1');
    expect((await new FakeSslProvider(configuration('ssl')).inspect('isp.example')).status).toBe(
      'valid',
    );
  });
});

describe('webhook and resilience contracts (REQ-INT-004)', () => {
  it('verifies signed webhooks, timestamps and replay claims', async () => {
    const now = new Date('2026-08-13T08:00:00.000Z');
    const timestamp = now.toISOString();
    const body = new TextEncoder().encode('{"event":"payment.verified"}');
    const secret = new TextEncoder().encode('test-only-webhook-secret');
    const signature = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), Buffer.from(body)]))
      .digest('hex');
    const replayStore = new InMemoryWebhookReplayStore();
    const envelope = {
      providerId: 'fake-payment',
      eventId: 'event-1',
      timestamp,
      signature,
      rawBody: body,
    };
    const verification = await verifyAndClaimWebhook({
      envelope,
      signingSecret: secret,
      replayStore,
      now,
    });
    const eventStore = new InMemoryWebhookEventStore();
    await storeVerifiedWebhook({
      verification,
      providerId: envelope.providerId,
      encryptedPayloadReference: 'secret://webhook-payloads/event-1',
      receivedAt: now,
      eventStore,
    });
    const claimed = await eventStore.claimForProcessing(envelope.providerId, envelope.eventId, 3);
    expect(claimed).toMatchObject({ state: 'processing', attempts: 1 });
    await eventStore.finish(envelope.providerId, envelope.eventId, {
      succeeded: false,
      safeError: 'Fake processing failure.',
    });
    expect(
      await eventStore.claimForProcessing(envelope.providerId, envelope.eventId, 3),
    ).toMatchObject({
      state: 'processing',
      attempts: 2,
    });
    await expect(
      verifyAndClaimWebhook({ envelope, signingSecret: secret, replayStore, now }),
    ).rejects.toMatchObject({ failureClass: 'replay' });
  });

  it('uses bounded retry and exposes final failures in a dead letter store', async () => {
    const deadLetters = new InMemoryProviderDeadLetterStore();
    const delays: number[] = [];
    const executor = new ProviderExecutor(
      'provider-1',
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 500,
        failureThreshold: 4,
        circuitResetMs: 1_000,
      },
      deadLetters,
      {
        sleep: (delayMs) => {
          delays.push(delayMs);
          return Promise.resolve();
        },
      },
      () => new Date('2026-08-13T08:00:00.000Z'),
    );
    await expect(
      executor.run(context, () =>
        Promise.reject(new ProviderError('rate_limited', true, 'Provider rate limit reached.')),
      ),
    ).rejects.toMatchObject({ failureClass: 'rate_limited' });
    expect(delays).toEqual([100, 200]);
    expect(await deadLetters.list('provider-1')).toHaveLength(1);
  });
});
