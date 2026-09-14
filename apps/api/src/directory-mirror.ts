import type { TenantDirectorySnapshot, VerifiedTenantId } from '@isp/contracts';

/**
 * Keeps the tenant database's staff directory (tenants, member identities, memberships) equal to
 * the control database, where staff are authoritative. The tenant side needs the rows because
 * operational records reference memberships for assignees, collectors, approvers and authors.
 */
export interface TenantDirectorySource {
  listTenantIds(): Promise<readonly string[]>;
  read(tenantId: VerifiedTenantId): Promise<TenantDirectorySnapshot | null>;
}
export interface TenantDirectoryTarget {
  apply(snapshot: TenantDirectorySnapshot): Promise<TenantDirectoryMirrorResult>;
}
export interface TenantDirectoryMirrorResult {
  readonly tenantId: string;
  readonly insertedUsers: number;
  readonly updatedUsers: number;
  readonly insertedMembers: number;
  readonly updatedMembers: number;
  readonly deactivatedMembers: number;
  readonly members: number;
}
export interface TenantDirectoryMirrorLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export class TenantDirectoryMirror {
  public constructor(
    private readonly source: TenantDirectorySource,
    private readonly target: TenantDirectoryTarget,
    private readonly log: TenantDirectoryMirrorLogger,
  ) {}

  /** Mirror one tenant; throws when the control database or the tenant database refuses. */
  public async sync(tenantId: VerifiedTenantId): Promise<TenantDirectoryMirrorResult | null> {
    const snapshot = await this.source.read(tenantId);
    if (!snapshot) {
      this.log.warn({ tenantId }, 'directory mirror skipped: tenant not found in control database');
      return null;
    }
    const result = await this.target.apply(snapshot);
    if (
      result.insertedUsers ||
      result.updatedUsers ||
      result.insertedMembers ||
      result.updatedMembers ||
      result.deactivatedMembers
    ) {
      this.log.info({ ...result }, 'directory mirror applied');
    }
    return result;
  }

  /** Reconcile every tenant; failures are logged per tenant and never abort the others. */
  public async syncAll(): Promise<{ readonly tenants: number; readonly failed: number }> {
    const ids = await this.source.listTenantIds();
    let failed = 0;
    for (const id of ids) {
      try {
        await this.sync(id as VerifiedTenantId);
      } catch (error) {
        failed += 1;
        this.log.warn(
          { tenantId: id, error: error instanceof Error ? error.message : String(error) },
          'directory mirror failed for tenant',
        );
      }
    }
    this.log.info({ tenants: ids.length, failed }, 'directory mirror reconcile finished');
    return { tenants: ids.length, failed };
  }
}
