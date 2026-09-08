import type { MessagingSecrets, SmsConfig, WhatsappConfig } from '@isp/contracts';

/**
 * Outbound text messaging through the provider a tenant configured. Every call is a single
 * HTTPS request with a bounded timeout; provider answers are reduced to a reference or an error
 * code so no credential can leak into logs, audit rows or the interface.
 */
export type MessagingErrorCode =
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_INVALID_RESPONSE';

export class MessagingError extends Error {
  public constructor(
    public readonly code: MessagingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}

export interface OutboundTextMessage {
  readonly to: string;
  readonly body: string;
}

export interface MessagingResult {
  readonly providerReference: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface MessagingOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

export async function sendSmsMessage(
  config: SmsConfig,
  secrets: MessagingSecrets,
  message: OutboundTextMessage,
  options: MessagingOptions = {},
): Promise<MessagingResult> {
  switch (config.provider) {
    case 'twilio':
      return twilioSend(
        {
          accountSid: config.accountSid,
          authToken: secrets.authToken,
          from: config.fromNumber,
          to: message.to,
          body: message.body,
        },
        options,
      );
    case 'http_json':
      return httpJsonSend(config.endpointUrl, secrets.authToken, message, config.senderId, options);
  }
}

export async function sendWhatsappMessage(
  config: WhatsappConfig,
  secrets: MessagingSecrets,
  message: OutboundTextMessage,
  options: MessagingOptions = {},
): Promise<MessagingResult> {
  switch (config.provider) {
    case 'twilio':
      return twilioSend(
        {
          accountSid: config.accountSid,
          authToken: secrets.authToken,
          from: `whatsapp:${config.fromNumber}`,
          to: `whatsapp:${message.to}`,
          body: message.body,
        },
        options,
      );
    case 'meta_cloud':
      return metaCloudSend(
        config.phoneNumberId,
        config.apiVersion,
        secrets.authToken,
        message,
        options,
      );
  }
}

async function twilioSend(
  input: {
    readonly accountSid: string;
    readonly authToken: string;
    readonly from: string;
    readonly to: string;
    readonly body: string;
  },
  options: MessagingOptions,
): Promise<MessagingResult> {
  const form = new URLSearchParams({ To: input.to, From: input.from, Body: input.body });
  const response = await request(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`, 'utf8').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form.toString(),
    },
    options,
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new MessagingError(
      'PROVIDER_REJECTED',
      `Twilio rejected the message (${response.status}${detail(payload, ['message'])}).`,
    );
  }
  const sid = payload.sid;
  if (typeof sid !== 'string' || sid.length === 0) {
    throw new MessagingError('PROVIDER_INVALID_RESPONSE', 'Twilio returned no message SID.');
  }
  return { providerReference: sid };
}

async function httpJsonSend(
  endpointUrl: string,
  bearerToken: string,
  message: OutboundTextMessage,
  senderId: string | undefined,
  options: MessagingOptions,
): Promise<MessagingResult> {
  const response = await request(
    endpointUrl,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        to: message.to,
        message: message.body,
        ...(senderId ? { senderId } : {}),
      }),
    },
    options,
  );
  const payload = await readJson(response);
  if (!response.ok) {
    throw new MessagingError(
      'PROVIDER_REJECTED',
      `The SMS gateway rejected the message (${response.status}${detail(payload, ['message', 'error'])}).`,
    );
  }
  const reference = [payload.id, payload.messageId, payload.message_id, payload.reference].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return { providerReference: reference ?? `accepted-${response.status}` };
}

async function metaCloudSend(
  phoneNumberId: string,
  apiVersion: string,
  accessToken: string,
  message: OutboundTextMessage,
  options: MessagingOptions,
): Promise<MessagingResult> {
  const response = await request(
    `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.to.replace(/^\+/u, ''),
        type: 'text',
        text: { preview_url: false, body: message.body },
      }),
    },
    options,
  );
  const payload = await readJson(response);
  if (!response.ok) {
    const error = (payload.error ?? {}) as Record<string, unknown>;
    throw new MessagingError(
      'PROVIDER_REJECTED',
      `WhatsApp Cloud API rejected the message (${response.status}${detail(error, ['message'])}).`,
    );
  }
  const messages = payload.messages;
  const first = Array.isArray(messages) ? (messages[0] as Record<string, unknown>) : undefined;
  if (!first || typeof first.id !== 'string') {
    throw new MessagingError(
      'PROVIDER_INVALID_RESPONSE',
      'WhatsApp Cloud API returned no message id.',
    );
  }
  return { providerReference: first.id };
}

async function request(
  url: string,
  init: RequestInit,
  options: MessagingOptions,
): Promise<Response> {
  const fetchImpl = options.fetch ?? ((input, requestInit) => fetch(input, requestInit));
  try {
    return await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new MessagingError(
        'PROVIDER_TIMEOUT',
        'The messaging provider did not answer in time.',
      );
    }
    throw new MessagingError(
      'PROVIDER_UNAVAILABLE',
      'The messaging provider could not be reached.',
    );
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function detail(payload: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return `: ${value.trim().slice(0, 160)}`;
  }
  return '';
}
