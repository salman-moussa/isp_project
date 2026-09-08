import {
  integrationConfigSchemas,
  integrationSecretSchemas,
  smsConfigSchema,
  smtpConfigSchema,
  whatsappConfigSchema,
  type IntegrationKind,
} from '@isp/contracts';
import type { StoredIntegrationDelivery } from '@isp/database';
import type { MailContent } from './mail-templates.js';
import {
  MessagingError,
  sendSmsMessage,
  sendWhatsappMessage,
  type MessagingOptions,
} from './messaging.js';
import { SecretBoxError, type SecretBox } from './secret-box.js';
import {
  SmtpError,
  sendSmtpMail,
  verifySmtpConnection,
  type MailMessage,
  type SmtpConnectionOptions,
} from './smtp-client.js';

export interface IntegrationTransports {
  readonly sendMail: (
    options: SmtpConnectionOptions,
    message: MailMessage,
  ) => Promise<{
    readonly messageId: string;
    readonly response: string;
  }>;
  readonly verifyMail: typeof verifySmtpConnection;
  readonly sendSms: typeof sendSmsMessage;
  readonly sendWhatsapp: typeof sendWhatsappMessage;
}

export interface IntegrationRuntime {
  readonly secretBox: SecretBox;
  readonly transports: IntegrationTransports;
  /** Production refuses credentials over cleartext SMTP; local development may relay to Mailpit. */
  readonly production: boolean;
  readonly messaging?: MessagingOptions;
}

export class IntegrationValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'INTEGRATION_VALIDATION_FAILED';
  public constructor(message: string) {
    super(message);
    this.name = 'IntegrationValidationError';
  }
}

export function createIntegrationTransports(): IntegrationTransports {
  return {
    sendMail: sendSmtpMail,
    verifyMail: verifySmtpConnection,
    sendSms: sendSmsMessage,
    sendWhatsapp: sendWhatsappMessage,
  };
}

export interface IntegrationConfigurationInput {
  readonly kind: IntegrationKind;
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly keepSecrets: boolean;
  readonly active: boolean;
  readonly expectedVersion?: number;
}

export interface PreparedIntegrationConfiguration {
  readonly kind: IntegrationKind;
  readonly config: Readonly<Record<string, unknown>>;
  readonly active: boolean;
  readonly keepSecrets: boolean;
  readonly expectedVersion?: number;
  readonly secretCiphertext?: Buffer;
  readonly cipherKeyId?: string;
  readonly protectedFields: readonly string[];
  readonly cipherFingerprint?: string;
}

/**
 * Validates configuration per provider, seals the secrets and decides whether the stored secret
 * is kept, replaced or cleared. Plaintext never leaves this function except inside ciphertext.
 */
export function prepareIntegrationConfiguration(
  runtime: IntegrationRuntime,
  input: IntegrationConfigurationInput,
): PreparedIntegrationConfiguration {
  const config = integrationConfigSchemas[input.kind].parse(input.config) as Record<
    string,
    unknown
  >;
  if (input.kind === 'smtp') {
    const smtp = smtpConfigSchema.parse(config);
    if (runtime.production && smtp.username && smtp.security === 'none') {
      throw new IntegrationValidationError(
        'Authenticated SMTP requires TLS or STARTTLS in production.',
      );
    }
  }
  const requiresSecret = input.kind !== 'smtp' || typeof config.username === 'string';
  if (input.secrets) {
    const secrets = integrationSecretSchemas[input.kind].parse(input.secrets) as Record<
      string,
      string
    >;
    return {
      kind: input.kind,
      config,
      active: input.active,
      keepSecrets: input.keepSecrets,
      ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
      secretCiphertext: runtime.secretBox.seal(secrets),
      cipherKeyId: runtime.secretBox.keyId,
      protectedFields: Object.keys(secrets).sort(),
      cipherFingerprint: runtime.secretBox.fingerprint(secrets),
    };
  }
  if (requiresSecret && !input.keepSecrets) {
    throw new IntegrationValidationError(
      'Provider credentials are required. Enter them or keep the stored credentials.',
    );
  }
  return {
    kind: input.kind,
    config,
    active: input.active,
    keepSecrets: input.keepSecrets,
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
    protectedFields: [],
  };
}

export function openIntegrationSecrets(
  runtime: IntegrationRuntime,
  stored: StoredIntegrationDelivery,
): Record<string, string> | undefined {
  if (!stored.secretCiphertext || !stored.cipherKeyId) return undefined;
  return runtime.secretBox.open(stored.secretCiphertext, stored.cipherKeyId);
}

export function smtpOptionsFor(
  runtime: IntegrationRuntime,
  stored: StoredIntegrationDelivery,
): {
  readonly options: SmtpConnectionOptions;
  readonly from: MailMessage['from'];
  readonly replyTo?: string;
} {
  const config = smtpConfigSchema.parse(stored.config);
  const secrets = openIntegrationSecrets(runtime, stored);
  return {
    options: {
      host: config.host,
      port: config.port,
      security: config.security,
      ...(config.username ? { username: config.username, password: secrets?.password ?? '' } : {}),
      timeoutMs: config.timeoutMs,
      requireTlsForAuth: runtime.production,
      clientName: 'orvex-isp',
    },
    from: { address: config.fromAddress, ...(config.fromName ? { name: config.fromName } : {}) },
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
  };
}

export interface IntegrationTestOutcome {
  readonly status: 'passed' | 'failed';
  readonly message: string;
  readonly recipientMasked: string;
  readonly providerReference?: string;
  readonly errorCode?: string;
}

/** Performs one real delivery through the configured provider and reports a sanitized outcome. */
export async function performIntegrationTest(
  runtime: IntegrationRuntime,
  stored: StoredIntegrationDelivery,
  recipient: string,
  content: { readonly mail: MailContent; readonly text: string },
): Promise<IntegrationTestOutcome> {
  const recipientMasked = maskRecipient(recipient);
  try {
    if (stored.kind === 'smtp') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) {
        throw new IntegrationValidationError('The SMTP test needs an email recipient.');
      }
      const smtp = smtpOptionsFor(runtime, stored);
      const result = await runtime.transports.sendMail(smtp.options, {
        from: smtp.from,
        to: recipient,
        ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
        subject: content.mail.subject,
        text: content.mail.text,
        html: content.mail.html,
      });
      return {
        status: 'passed',
        message: `Test email accepted by ${smtp.options.host}: ${result.response}`.slice(0, 500),
        recipientMasked,
        providerReference: result.messageId,
      };
    }
    if (!/^\+[1-9][0-9]{6,14}$/u.test(recipient)) {
      throw new IntegrationValidationError(
        'Messaging tests need an international phone number (+country…).',
      );
    }
    const secrets = openIntegrationSecrets(runtime, stored);
    if (!secrets?.authToken) {
      throw new IntegrationValidationError('The provider credential is missing; save it first.');
    }
    const message = { to: recipient, body: content.text };
    const result =
      stored.kind === 'sms'
        ? await runtime.transports.sendSms(
            smsConfigSchema.parse(stored.config),
            { authToken: secrets.authToken },
            message,
            runtime.messaging ?? {},
          )
        : await runtime.transports.sendWhatsapp(
            whatsappConfigSchema.parse(stored.config),
            { authToken: secrets.authToken },
            message,
            runtime.messaging ?? {},
          );
    return {
      status: 'passed',
      message: `Test message accepted by the provider (${result.providerReference}).`,
      recipientMasked,
      providerReference: result.providerReference,
    };
  } catch (error) {
    if (error instanceof IntegrationValidationError) throw error;
    if (
      error instanceof SmtpError ||
      error instanceof MessagingError ||
      error instanceof SecretBoxError
    ) {
      return {
        status: 'failed',
        message: error.message.slice(0, 500),
        recipientMasked,
        errorCode: error.code,
      };
    }
    return {
      status: 'failed',
      message: 'The provider test failed unexpectedly; check the configuration and retry.',
      recipientMasked,
      errorCode: 'UNEXPECTED',
    };
  }
}

/** Keeps only enough of a recipient to recognise it in delivery evidence. */
export function maskRecipient(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (at > 0) {
    const local = trimmed.slice(0, at);
    return `${local.slice(0, 1)}***@${trimmed.slice(at + 1)}`;
  }
  if (trimmed.startsWith('+')) {
    return `${trimmed.slice(0, 4)}****${trimmed.slice(-3)}`;
  }
  return `${trimmed.slice(0, 2)}***`;
}
