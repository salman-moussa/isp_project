import { z } from 'zod';

/**
 * Integration settings shared by the Control Center (platform SMTP for authentication mail) and
 * tenant workspaces (each ISP's own SMTP, SMS and WhatsApp providers). Configuration is
 * non-secret JSON; secrets are write-only and are never echoed back by any read.
 */
export const integrationKindSchema = z.enum(['smtp', 'sms', 'whatsapp']);
export type IntegrationKind = z.infer<typeof integrationKindSchema>;

export const smtpSecuritySchema = z.enum(['starttls', 'tls', 'none']);
export type SmtpSecurity = z.infer<typeof smtpSecuritySchema>;

const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i,
    'Invalid host name.',
  );
const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, 'Use the international +country format.');
const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'Provider endpoints must use HTTPS.');
const twilioAccountSid = z
  .string()
  .trim()
  .regex(/^AC[0-9a-fA-F]{32}$/, 'Invalid Twilio account SID.');

export const smtpConfigSchema = z
  .object({
    host: hostname,
    port: z.number().int().min(1).max(65_535),
    security: smtpSecuritySchema,
    username: z.string().trim().min(1).max(320).optional(),
    fromAddress: z.email(),
    fromName: z.string().trim().min(1).max(120).optional(),
    replyTo: z.email().optional(),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
  })
  .strict();
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;
export const smtpSecretsSchema = z.object({ password: z.string().min(1).max(512) }).strict();
export type SmtpSecrets = z.infer<typeof smtpSecretsSchema>;

export const smsConfigSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('twilio'),
      accountSid: twilioAccountSid,
      fromNumber: e164,
    })
    .strict(),
  z
    .object({
      provider: z.literal('http_json'),
      endpointUrl: httpsUrl,
      senderId: z.string().trim().min(1).max(20).optional(),
    })
    .strict(),
]);
export type SmsConfig = z.infer<typeof smsConfigSchema>;

export const whatsappConfigSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('twilio'),
      accountSid: twilioAccountSid,
      fromNumber: e164,
    })
    .strict(),
  z
    .object({
      provider: z.literal('meta_cloud'),
      phoneNumberId: z
        .string()
        .trim()
        .regex(/^[0-9]{5,32}$/, 'Invalid phone number id.'),
      apiVersion: z
        .string()
        .trim()
        .regex(/^v[0-9]{2}\.[0-9]$/)
        .default('v20.0'),
    })
    .strict(),
]);
export type WhatsappConfig = z.infer<typeof whatsappConfigSchema>;

/** SMS and WhatsApp providers use one credential: a Twilio auth token, bearer or access token. */
export const messagingSecretsSchema = z.object({ authToken: z.string().min(8).max(2048) }).strict();
export type MessagingSecrets = z.infer<typeof messagingSecretsSchema>;

export const integrationConfigSchemas = {
  smtp: smtpConfigSchema,
  sms: smsConfigSchema,
  whatsapp: whatsappConfigSchema,
} as const;
export const integrationSecretSchemas = {
  smtp: smtpSecretsSchema,
  sms: messagingSecretsSchema,
  whatsapp: messagingSecretsSchema,
} as const;

const configureShape = {
  keepSecrets: z.boolean().default(false),
  active: z.boolean().default(true),
  expectedVersion: z.number().int().positive().optional(),
};
const bilingualEvidence = {
  reasonEn: z.string().trim().min(8).max(1000),
  reasonAr: z.string().trim().min(8).max(1000),
  evidence: z.string().trim().min(8).max(2000),
};
const platformReason = { reason: z.string().trim().min(8).max(500) };

const smtpConfigure = z.object({
  kind: z.literal('smtp'),
  config: smtpConfigSchema,
  secrets: smtpSecretsSchema.optional(),
  ...configureShape,
});
const smsConfigure = z.object({
  kind: z.literal('sms'),
  config: smsConfigSchema,
  secrets: messagingSecretsSchema.optional(),
  ...configureShape,
});
const whatsappConfigure = z.object({
  kind: z.literal('whatsapp'),
  config: whatsappConfigSchema,
  secrets: messagingSecretsSchema.optional(),
  ...configureShape,
});

/** Tenant command: bilingual evidence like every other Operations mutation. */
export const integrationConfigureCommandSchema = z.discriminatedUnion('kind', [
  smtpConfigure.extend(bilingualEvidence).strict(),
  smsConfigure.extend(bilingualEvidence).strict(),
  whatsappConfigure.extend(bilingualEvidence).strict(),
]);
export type IntegrationConfigureCommand = z.infer<typeof integrationConfigureCommandSchema>;

/** Control Center body: a single reason, matching other Control Center mutations. */
export const platformIntegrationConfigureBodySchema = z.discriminatedUnion('kind', [
  smtpConfigure.extend(platformReason).strict(),
  smsConfigure.extend(platformReason).strict(),
  whatsappConfigure.extend(platformReason).strict(),
]);
export type PlatformIntegrationConfigureBody = z.infer<
  typeof platformIntegrationConfigureBodySchema
>;

const recipient = z.string().trim().min(3).max(320);
export const integrationTestCommandSchema = z
  .object({ kind: integrationKindSchema, recipient, ...bilingualEvidence })
  .strict();
export type IntegrationTestCommand = z.infer<typeof integrationTestCommandSchema>;
export const platformIntegrationTestBodySchema = z
  .object({ kind: integrationKindSchema, recipient, ...platformReason })
  .strict();
export type PlatformIntegrationTestBody = z.infer<typeof platformIntegrationTestBodySchema>;

export const integrationTestStatusSchema = z.enum(['passed', 'failed']);
export const integrationSettingRecordSchema = z.object({
  id: z.string().optional(),
  kind: integrationKindSchema,
  version: z.number().int().positive(),
  active: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  secretConfigured: z.boolean(),
  protectedFields: z.array(z.string()),
  cipherKeyId: z.string().nullable().optional(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  lastTestAt: z.string().nullable().optional(),
  lastTestStatus: integrationTestStatusSchema.nullable().optional(),
  lastTestMessage: z.string().nullable().optional(),
});
export type IntegrationSettingRecord = z.infer<typeof integrationSettingRecordSchema>;

export interface IntegrationSettingEvent {
  readonly id: string;
  readonly kind: IntegrationKind;
  readonly version: number;
  readonly action: 'configure' | 'test';
  readonly actorId: string;
  readonly reason: string;
  readonly reasonAr?: string;
  readonly secretChanged: boolean;
  readonly testStatus?: 'passed' | 'failed' | null;
  readonly testMessage?: string | null;
  readonly occurredAt: string;
}

export interface MessageDeliveryRecord {
  readonly id: string;
  readonly purpose: 'otp' | 'recovery' | 'staff_invitation' | 'integration_test';
  readonly channel: IntegrationKind;
  readonly recipient: string;
  readonly status: 'sent' | 'failed';
  readonly providerReference?: string | null;
  readonly errorCode?: string | null;
  readonly occurredAt: string;
}

export interface IntegrationTestResult extends IntegrationSettingRecord {
  readonly status: 'passed' | 'failed';
  readonly recipient: string;
  readonly providerReference?: string | null;
  readonly replay?: boolean;
  readonly replayed?: boolean;
}

export interface PlatformIntegrationWorkspace {
  readonly settings: readonly IntegrationSettingRecord[];
  readonly recentEvents: readonly IntegrationSettingEvent[];
  readonly recentDeliveries: readonly MessageDeliveryRecord[];
}

export interface TenantIntegrationWorkspace {
  readonly settings: readonly IntegrationSettingRecord[];
  readonly events: readonly IntegrationSettingEvent[];
}
