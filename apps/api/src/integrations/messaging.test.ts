import { describe, expect, it, vi } from 'vitest';
import {
  MessagingError,
  sendSmsMessage,
  sendWhatsappMessage,
  type FetchLike,
} from './messaging.js';

function fakeFetch(
  status: number,
  body: unknown,
): { fetch: FetchLike; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

describe('messaging providers', () => {
  it('sends SMS through Twilio with basic auth and returns the message SID', async () => {
    const { fetch, calls } = fakeFetch(201, { sid: 'SM123' });
    const result = await sendSmsMessage(
      { provider: 'twilio', accountSid: `AC${'a'.repeat(32)}`, fromNumber: '+96170000000' },
      { authToken: 'token-value-1234' },
      { to: '+96171111111', body: 'hello' },
      { fetch },
    );
    expect(result).toEqual({ providerReference: 'SM123' });
    expect(calls[0]?.url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages.json`,
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from(`AC${'a'.repeat(32)}:token-value-1234`).toString('base64')}`,
    );
    expect(calls[0]?.init.body as string).toContain('To=%2B96171111111');
  });

  it('surfaces provider rejections without leaking the credential', async () => {
    const { fetch } = fakeFetch(401, { message: 'Authenticate' });
    const failure = await sendSmsMessage(
      { provider: 'http_json', endpointUrl: 'https://gateway.test/send' },
      { authToken: 'bearer-secret-value' },
      { to: '+96171111111', body: 'hello' },
      { fetch },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MessagingError);
    expect((failure as MessagingError).code).toBe('PROVIDER_REJECTED');
    expect((failure as MessagingError).message).toContain('Authenticate');
    expect((failure as MessagingError).message).not.toContain('bearer-secret-value');
  });

  it('sends WhatsApp through the Meta Cloud API and maps timeouts', async () => {
    const { fetch, calls } = fakeFetch(200, { messages: [{ id: 'wamid.1' }] });
    const result = await sendWhatsappMessage(
      { provider: 'meta_cloud', phoneNumberId: '1234567', apiVersion: 'v20.0' },
      { authToken: 'meta-access-token' },
      { to: '+96171111111', body: 'hello' },
      { fetch },
    );
    expect(result).toEqual({ providerReference: 'wamid.1' });
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v20.0/1234567/messages');
    expect(JSON.parse(calls[0]?.init.body as string) as unknown).toMatchObject({
      messaging_product: 'whatsapp',
      to: '96171111111',
    });

    const timeout: FetchLike = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    });
    await expect(
      sendWhatsappMessage(
        { provider: 'twilio', accountSid: `AC${'b'.repeat(32)}`, fromNumber: '+96170000000' },
        { authToken: 'token-value-1234' },
        { to: '+96171111111', body: 'hello' },
        { fetch: timeout },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });
});
