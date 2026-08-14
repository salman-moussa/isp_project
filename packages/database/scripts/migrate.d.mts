export type MigrationDatabaseScope = 'all' | 'control' | 'tenant';

export interface MigrationTarget {
  readonly databaseUrl: string;
  readonly databaseScope: MigrationDatabaseScope;
}

export function loadMigrationPlan(databaseScope?: MigrationDatabaseScope): Promise<string[]>;
export function migrate(
  databaseUrl?: string,
  options?: { readonly databaseScope?: MigrationDatabaseScope },
): Promise<void>;
export function resolveConfiguredMigrationTargets(
  environment?: Record<string, string | undefined>,
): MigrationTarget[];
export function migrateConfiguredDatabases(
  environment?: Record<string, string | undefined>,
): Promise<void>;
