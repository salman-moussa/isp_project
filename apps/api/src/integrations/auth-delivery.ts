import { createHmac, randomInt } from 'node:crypto';
import type {
  AuthDeliveryTarget,
  MessageDeliveryEvidence,
  StoredIntegrationDelivery,
} from '@isp/database';
import type { OtpAdapter, RecoveryDeliveryAdapter } from '../auth-service.js';
import type { StaffInvitationDeliveryAdapter } from '../staff.js';
import { otpMail, recoveryMail, staffInvitationMail, type MailContent } from './mail-templates.js';
import { maskRecipient, smtpOptionsFor, type IntegrationRuntime } from './runtime.js';
import { SmtpError } from './smtp-client.js';

/** Raised when no delivery channel is configured or the configured one fails. Fails closed. */
export class AuthDeliveryUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'AUTH_DELIVERY_UNAVAILABLE';
  public constructor(
    message = 'Verification messages cannot be delivered until platform SMTP is configured in the Control Center.',
  ) {
    super(message);
    this.name = 'AuthDeliveryUnavailableError';
  }
}

export interface AuthDeliveryStore {
  readIntegration(kind: 'smtp'): Promise<StoredIntegrationDelivery | null>;
  readTarget(userId: string): Promise<AuthDeliveryTarget | null>;
  storeOtp(challengeId: string, codeDigest: string, expiresAt: Date): Promise<void>;
  verifyOtp(
    challengeId: string,
    codeDigest: string,
    now: Date,
    maximumAttempts: number,
  ): Promise<boolean>;
  recordDelivery(evidence: MessageDeliveryEvidence): Promise<void>;
}

export type FallbackAuthDelivery = OtpAdapter &
  RecoveryDeliveryAdapter &
  StaffInvitationDeliveryAdapter;

export interface DatabaseAuthDeliveryOptions {
  readonly runtime: IntegrationRuntime;
  readonly digestSecret: Uint8Array;
  /** Public web origins used in recovery and invitation links. */
  readonly webUrls: { readonly platform: string; readonly tenant: string };
  readonly now?: () => Date;
  /** Optional external provider used only while no SMTP settings exist. */
  readonly fallback?: FallbackAuthDelivery;
  readonly maximumAttempts?: number;
}

const REMOTE_PREFIX = 'remote:';

/**
 * Sends OTP codes, recovery links and staff invitations through the platform SMTP settings
 * stored in the control database. Codes are stored as keyed digests; message bodies are never
 * persisted, and delivery evidence carries a masked recipient only.
 */
export class DatabaseAuthDeliveryAdapter
  implements OtpAdapter, RecoveryDeliveryAdapter, StaffInvitationDeliveryAdapter
{
  private readonly now: () => Date;

  public constructor(
    private readonly store: AuthDeliveryStore,
    private readonly options: DatabaseAuthDeliveryOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async start(input: { userId: string; challengeId: string; expiresAt: Date }) {
    const smtp = await this.store.readIntegration('smtp');
    if (!smtp) {
      if (this.options.fallback) {
        const started = await this.options.fallback.start(input);
        return { adapterReference: `${REMOTE_PREFIX}${started.adapterReference}` };
      }
      throw new AuthDeliveryUnavailableError();
    }
    const target = await this.store.readTarget(input.userId);
    if (!target)
      throw new AuthDeliveryUnavailableError('The account cannot receive verification codes.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.store.storeOtp(
      input.challengeId,
      this.digest(input.challengeId, code),
      input.expiresAt,
    );
    await this.send(
      smtp,
      target.email,
      otpMail({ code, expiresAt: input.expiresAt, displayName: target.displayName }),
      { purpose: 'otp', userId: input.userId },
    );
    return { adapterReference: input.challengeId };
  }

  public async verify(input: { adapterReference: string; code: string }): Promise<boolean> {
    if (input.adapterReference.startsWith(REMOTE_PREFIX)) {
      return (
        (await this.options.fallback?.verify({
          adapterReference: input.adapterReference.slice(REMOTE_PREFIX.length),
          code: input.code,
        })) ?? false
      );
    }
    if (!/^[0-9]{6}$/u.test(input.code)) return false;
    return this.store.verifyOtp(
      input.adapterReference,
      this.digest(input.adapterReference, input.code),
      this.now(),
      this.options.maximumAttempts ?? 5,
    );
  }

  public async deliver(input: { userId: string; email: string; token: string; expiresAt: Date }) {
    const smtp = await this.store.readIntegration('smtp');
    if (!smtp) {
      if (this.options.fallback) return this.options.fallback.deliver(input);
      throw new AuthDeliveryUnavailableError();
    }
    const target = await this.store.readTarget(input.userId);
    const base = this.options.webUrls[target?.accountKind === 'platform' ? 'platform' : 'tenant'];
    await this.send(
      smtp,
      input.email,
      recoveryMail({
        displayName: target?.displayName ?? input.email,
        link: `${base}/#/recovery/${encodeURIComponent(input.token)}`,
        expiresAt: input.expiresAt,
      }),
      { purpose: 'recovery', userId: input.userId },
    );
  }

  public async deliverInvitation(input: {
    invitationId: string;
    tenantId: string;
    email: string;
    displayName: string;
    token: string;
    expiresAt: Date;
  }) {
    const smtp = await this.store.readIntegration('smtp');
    if (!smtp) {
      if (this.options.fallback) return this.options.fallback.deliverInvitation(input);
      throw new AuthDeliveryUnavailableError();
    }
    await this.send(
      smtp,
      input.email,
      staffInvitationMail({
        displayName: input.displayName,
        link: `${this.options.webUrls.tenant}/#/staff-invitation/${encodeURIComponent(input.token)}`,
        expiresAt: input.expiresAt,
      }),
      { purpose: 'staff_invitation', tenantId: input.tenantId },
    );
  }

  private async send(
    stored: StoredIntegrationDelivery,
    to: string,
    content: MailContent,
    evidence: {
      readonly purpose: MessageDeliveryEvidence['purpose'];
      readonly userId?: string;
      readonly tenantId?: string;
    },
  ): Promise<void> {
    const base = {
      purpose: evidence.purpose,
      channel: 'smtp' as const,
      recipientMasked: maskRecipient(to),
      ...(evidence.userId ? { userId: evidence.userId } : {}),
      ...(evidence.tenantId ? { tenantId: evidence.tenantId } : {}),
    };
    try {
      const smtp = smtpOptionsFor(this.options.runtime, stored);
      const result = await this.options.runtime.transports.sendMail(smtp.options, {
        from: smtp.from,
        to,
        ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      await this.store.recordDelivery({
        ...base,
        status: 'sent',
        providerReference: result.messageId,
      });
    } catch (error) {
      await this.store
        .recordDelivery({
          ...base,
          status: 'failed',
          errorCode: error instanceof SmtpError ? error.code : 'UNEXPECTED',
        })
        .catch(() => undefined);
      throw new AuthDeliveryUnavailableError(
        'The verification message could not be sent. Check the platform SMTP settings.',
      );
    }
  }

  private digest(challengeId: string, code: string): string {
    return createHmac('sha256', Buffer.from(this.options.digestSecret))
      .update(`${challengeId}:${code}`)
      .digest('hex');
  }
}
