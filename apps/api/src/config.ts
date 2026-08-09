import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  JWT_SECRET: z.string().min(32),
  SUPPORT_TOKEN_ISSUER: z.string().min(1),
  SUPPORT_TOKEN_AUDIENCE: z.string().min(1),
  CONTROL_DATABASE_URL: z.string().url(),
  TENANT_DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function readConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  return configSchema.parse(environment);
}
