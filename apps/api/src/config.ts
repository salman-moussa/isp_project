import { z } from 'zod';

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    JWT_SECRET: z.string().min(32),
    SUPPORT_TOKEN_ISSUER: z.string().min(1),
    SUPPORT_TOKEN_AUDIENCE: z.string().min(1),
    AUTH_CONTROL_DATABASE_URL: z.string().url(),
    CONTROL_DATABASE_URL: z.string().url(),
    CONTROL_CONTEXT_KEY_ID: z.string().regex(/^[a-zA-Z0-9._-]{3,64}$/),
    CONTROL_CONTEXT_SECRET_BASE64: z.string().min(44).max(512),
    TENANT_DATABASE_URL: z.string().url(),
    OPERATIONS_CONTEXT_KEY_ID: z.string().regex(/^[a-zA-Z0-9._-]{3,64}$/),
    OPERATIONS_CONTEXT_SECRET_BASE64: z.string().min(44).max(512),
    AUTH_TOKEN_DIGEST_SECRET_BASE64: z.string().min(44).max(512).optional(),
    AUTH_DELIVERY_BASE_URL: z.string().url().optional(),
    AUTH_DELIVERY_TOKEN: z.string().min(32).optional(),
    FINANCE_AUDIT_READINESS_URL: z.string().url().optional(),
    NETWORK_WORKER_READINESS_URL: z.string().url().optional(),
    DOCUMENT_S3_BUCKET: z.string().min(3).max(63).optional(),
    DOCUMENT_S3_REGION: z.string().min(1).optional(),
    DOCUMENT_S3_ENDPOINT: z.string().url().optional(),
    DOCUMENT_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  })
  .superRefine((configuration, context) => {
    if (configuration.NODE_ENV !== 'production') return;
    if (
      configuration.DOCUMENT_S3_ENDPOINT &&
      !configuration.DOCUMENT_S3_ENDPOINT.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DOCUMENT_S3_ENDPOINT'],
        message: 'Production document storage requires HTTPS.',
      });
    }
    for (const field of ['FINANCE_AUDIT_READINESS_URL', 'NETWORK_WORKER_READINESS_URL'] as const) {
      if (!configuration[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required in production.`,
        });
      }
    }
  });

export type ApiConfig = z.infer<typeof configSchema>;

export function readConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  return configSchema.parse(environment);
}
