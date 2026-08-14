import { z } from 'zod';

const configSchema = z.object({
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
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function readConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  return configSchema.parse(environment);
}
