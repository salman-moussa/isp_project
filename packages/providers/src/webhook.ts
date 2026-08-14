import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from './types.js';

export interface WebhookEnvelope {
  readonly providerId: string;
  readonly eventId: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly rawBody: Uint8Array;
}

export interface WebhookReplayStore {
  claim(
    providerId: string,
    eventId: string,
    fingerprint: string,
    receivedAt: Date,
  ): Promise<boolean>;
}

export class InMemoryWebhookReplayStore implements WebhookReplayStore {
  readonly #claims = new Map<string, string>();
  async claim(providerId: string, eventId: string, fingerprint: string): Promise<boolean> {
    const key = `${providerId}:${eventId}`;
    if (this.#claims.has(key)) return false;
    this.#claims.set(key, fingerprint);
    return true;
  }
}

export interface StoredWebhookEvent {
  readonly providerId: string;
  readonly eventId: string;
  readonly fingerprint: string;
  readonly encryptedPayloadReference: `secret://${string}`;
  readonly state: 'received' | 'processing' | 'succeeded' | 'failed' | 'dead_lettered';
  readonly attempts: number;
  readonly receivedAt: string;
  readonly lastSafeError?: string;
}

export interface DurableWebhookEventStore {
  store(event: StoredWebhookEvent): Promise<void>;
  claimForProcessing(
    providerId: string,
    eventId: string,
    maxAttempts: number,
  ): Promise<StoredWebhookEvent | undefined>;
  finish(
    providerId: string,
    eventId: string,
    result: { succeeded: boolean; safeError?: string },
  ): Promise<void>;
  get(providerId: string, eventId: string): Promise<StoredWebhookEvent | undefined>;
}

export class InMemoryWebhookEventStore implements DurableWebhookEventStore {
  readonly #events = new Map<string, StoredWebhookEvent>();

  async store(event: StoredWebhookEvent): Promise<void> {
    const key = `${event.providerId}:${event.eventId}`;
    if (this.#events.has(key))
      throw new ProviderError('replay', false, 'Webhook event is already stored.');
    this.#events.set(key, structuredClone(event));
  }

  async claimForProcessing(
    providerId: string,
    eventId: string,
    maxAttempts: number,
  ): Promise<StoredWebhookEvent | undefined> {
    const key = `${providerId}:${eventId}`;
    const event = this.#events.get(key);
    if (event === undefined || event.state === 'succeeded' || event.state === 'processing')
      return undefined;
    const attempts = event.attempts + 1;
    const claimed: StoredWebhookEvent = {
      ...event,
      attempts,
      state: attempts > maxAttempts ? 'dead_lettered' : 'processing',
    };
    this.#events.set(key, claimed);
    return structuredClone(claimed);
  }

  async finish(
    providerId: string,
    eventId: string,
    result: { succeeded: boolean; safeError?: string },
  ): Promise<void> {
    const key = `${providerId}:${eventId}`;
    const event = this.#events.get(key);
    if (event?.state !== 'processing') throw new Error('Webhook event is not processing.');
    this.#events.set(key, {
      ...event,
      state: result.succeeded ? 'succeeded' : 'failed',
      ...(result.safeError === undefined ? {} : { lastSafeError: result.safeError }),
    });
  }

  async get(providerId: string, eventId: string): Promise<StoredWebhookEvent | undefined> {
    const event = this.#events.get(`${providerId}:${eventId}`);
    return event === undefined ? undefined : structuredClone(event);
  }
}

export async function storeVerifiedWebhook(input: {
  readonly verification: { readonly eventId: string; readonly fingerprint: string };
  readonly providerId: string;
  readonly encryptedPayloadReference: `secret://${string}`;
  readonly receivedAt: Date;
  readonly eventStore: DurableWebhookEventStore;
}): Promise<void> {
  await input.eventStore.store({
    providerId: input.providerId,
    eventId: input.verification.eventId,
    fingerprint: input.verification.fingerprint,
    encryptedPayloadReference: input.encryptedPayloadReference,
    state: 'received',
    attempts: 0,
    receivedAt: input.receivedAt.toISOString(),
  });
}

function signatureBytes(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new ProviderError('authentication', false, 'Webhook signature is malformed.');
  return Buffer.from(value, 'hex');
}

export async function verifyAndClaimWebhook(input: {
  envelope: WebhookEnvelope;
  signingSecret: Uint8Array;
  replayStore: WebhookReplayStore;
  now: Date;
  toleranceMs?: number;
}): Promise<{ readonly eventId: string; readonly fingerprint: string }> {
  const toleranceMs = input.toleranceMs ?? 300_000;
  const timestampMs = Date.parse(input.envelope.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(input.now.getTime() - timestampMs) > toleranceMs) {
    throw new ProviderError('replay', false, 'Webhook timestamp is outside the accepted window.');
  }
  const canonical = Buffer.concat([
    Buffer.from(input.envelope.timestamp, 'utf8'),
    Buffer.from('.', 'utf8'),
    Buffer.from(input.envelope.rawBody),
  ]);
  const expected = createHmac('sha256', input.signingSecret).update(canonical).digest();
  const supplied = signatureBytes(input.envelope.signature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ProviderError('authentication', false, 'Webhook signature is invalid.');
  }
  const fingerprint = createHmac('sha256', input.signingSecret)
    .update(input.envelope.rawBody)
    .digest('hex');
  const claimed = await input.replayStore.claim(
    input.envelope.providerId,
    input.envelope.eventId,
    fingerprint,
    input.now,
  );
  if (!claimed)
    throw new ProviderError('replay', false, 'Webhook event has already been received.');
  return { eventId: input.envelope.eventId, fingerprint };
}
