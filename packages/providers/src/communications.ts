import { BaseFakeProvider } from './base.js';
import { ProviderError, type ProviderRequestContext } from './types.js';

export class FakeEmailProvider extends BaseFakeProvider {
  readonly #messages: { to: string; templateId: string; correlationId: string }[] = [];
  async send(
    input: { to: string; templateId: string },
    context: ProviderRequestContext,
  ): Promise<{ messageId: string }> {
    this.assertOperational();
    if (!/^\S+@\S+\.\S+$/.test(input.to))
      throw new ProviderError('invalid_request', false, 'Email address is invalid.');
    this.#messages.push({ ...input, correlationId: context.requestId });
    return { messageId: `fake-email-${context.idempotencyKey}` };
  }
}

export class FakeOtpProvider extends BaseFakeProvider {
  readonly #challenges = new Map<string, { hash: string; expiresAt: number; used: boolean }>();
  async issue(
    subjectId: string,
    context: ProviderRequestContext,
  ): Promise<{ challengeId: string; testCode: string }> {
    this.assertOperational();
    const challengeId = `fake-otp-${context.idempotencyKey}`;
    this.#challenges.set(challengeId, {
      hash: 'hash-000000',
      expiresAt: context.deadline.getTime(),
      used: false,
    });
    return { challengeId, testCode: '000000' };
  }
  async verify(challengeId: string, code: string, now: Date): Promise<boolean> {
    const challenge = this.#challenges.get(challengeId);
    if (challenge === undefined || challenge.used || now.getTime() > challenge.expiresAt)
      return false;
    if (`hash-${code}` !== challenge.hash) return false;
    challenge.used = true;
    return true;
  }
}

export class WhatsAppDeepLinkProvider extends BaseFakeProvider {
  createShareLink(input: { phoneE164: string; documentUrl: URL; message: string }): URL {
    this.assertOperational();
    if (!/^\+[1-9]\d{7,14}$/.test(input.phoneE164)) {
      throw new ProviderError('invalid_request', false, 'Phone number must use E.164 format.');
    }
    if (input.documentUrl.protocol !== 'https:') {
      throw new ProviderError('invalid_request', false, 'Shared document URL must use HTTPS.');
    }
    const url = new URL('https://wa.me/');
    url.pathname = input.phoneE164.slice(1);
    url.searchParams.set('text', `${input.message}\n${input.documentUrl.toString()}`);
    return url;
  }
}
