import type { AuthorizationScope } from './permissions.js';

/**
 * One tenant's staff directory as the control database holds it: the tenant row, every member
 * identity and every membership. The tenant database mirrors this snapshot so operational records
 * can reference memberships; it never derives authority from it.
 */
export interface TenantDirectoryMember {
  readonly userId: string;
  readonly membershipId: string;
  readonly email: string;
  readonly displayName: string;
  readonly mfaRequired: boolean;
  readonly disabledAt: string | null;
  readonly roleKey: string;
  readonly permissions: readonly string[];
  readonly scope: AuthorizationScope;
  readonly active: boolean;
}
export interface TenantDirectorySnapshot {
  readonly tenant: {
    readonly id: string;
    readonly code: string;
    readonly brandName: string;
    readonly legalName: string;
    readonly status: string;
    readonly timezone: string;
    readonly defaultLocale: string;
    readonly archivedAt: string | null;
  };
  readonly members: readonly TenantDirectoryMember[];
}
