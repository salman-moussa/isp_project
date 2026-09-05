/**
 * Type surface for the plain-ESM migration preflight that ships beside the migrator.
 * The script stays untyped JavaScript so it can run unmodified inside the production
 * `migrate` image, which contains no TypeScript toolchain.
 */
export type MigrationScope = 'all' | 'both' | 'control' | 'tenant';

export type AppliedMigrationRow = {
  readonly name: string;
  readonly checksum: string;
};

export type BlockingFindingKind =
  | 'checksum_mismatch'
  | 'applied_missing_locally'
  | 'pending_out_of_order';

export type BlockingFinding = {
  readonly kind: BlockingFindingKind;
  readonly name: string;
  readonly detail: string;
};

export type PlanComparison = {
  readonly matched: number;
  readonly pending: string[];
  readonly blocking: BlockingFinding[];
  readonly lastApplied: string;
};

export type PreflightReport = PlanComparison & {
  readonly databaseScope: MigrationScope;
  readonly packagedCount: number;
  readonly appliedCount: number;
};

export declare function computePackagedChecksums(
  databaseScope: MigrationScope,
): Promise<Map<string, string>>;

export declare function comparePlan(
  packagedChecksums: Map<string, string>,
  appliedRows: readonly AppliedMigrationRow[],
): PlanComparison;

export declare function preflight(environment?: NodeJS.ProcessEnv): Promise<PreflightReport[]>;
