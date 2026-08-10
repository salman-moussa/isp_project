import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(scriptDirectory, '../migrations');

export async function migrate(databaseUrl = process.env.DATABASE_MIGRATION_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_MIGRATION_URL is required; no privileged fallback DSN is allowed');
  }

  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
  });

  try {
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    for (const name of migrationNames) {
      const contents = await readFile(resolve(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');

      await client.begin(async (transaction) => {
        await transaction.unsafe('SET LOCAL ROLE orvex_owner');
        await transaction.unsafe('SET LOCAL search_path TO public, pg_catalog');
        await transaction.unsafe(`
          CREATE TABLE IF NOT EXISTS public._orvex_migrations (
            name text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
          )
        `);

        const applied = await transaction`
          SELECT checksum FROM public._orvex_migrations WHERE name = ${name}
        `;
        if (applied.length > 0) {
          if (applied[0].checksum !== checksum) {
            throw new Error(`Applied migration ${name} has changed`);
          }
          return;
        }

        await transaction.unsafe(contents);
        await transaction`
          INSERT INTO public._orvex_migrations (name, checksum) VALUES (${name}, ${checksum})
        `;
      });
      console.log(`Database migration ready: ${name}`);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function migrateConfiguredDatabases(environment = process.env) {
  const controlUrl = environment.CONTROL_DATABASE_MIGRATION_URL;
  const tenantUrl = environment.TENANT_DATABASE_MIGRATION_URL;
  if (controlUrl || tenantUrl) {
    if (!controlUrl || !tenantUrl) {
      throw new Error(
        'CONTROL_DATABASE_MIGRATION_URL and TENANT_DATABASE_MIGRATION_URL must be configured together',
      );
    }
    await migrate(controlUrl);
    if (tenantUrl !== controlUrl) await migrate(tenantUrl);
    return;
  }
  await migrate(environment.DATABASE_MIGRATION_URL);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  migrateConfiguredDatabases().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
