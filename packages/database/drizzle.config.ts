import { defineConfig } from 'drizzle-kit';

const migrationDatabaseUrl = process.env.DATABASE_MIGRATION_URL;

if (!migrationDatabaseUrl) {
  throw new Error('DATABASE_MIGRATION_URL is required for database generation and migration');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: migrationDatabaseUrl,
  },
  strict: true,
  verbose: true,
});
