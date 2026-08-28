import type { VerifiedTenantId } from '@isp/contracts';

export interface TenantStaffMember {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleKey: string;
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly mfaRequired: boolean;
  readonly disabled: boolean;
  readonly authorizationVersion: number;
  readonly scope: {
    readonly branchIds?: readonly string[];
    readonly areaIds?: readonly string[];
    readonly routeIds?: readonly string[];
    readonly recordIds?: readonly string[];
  };
  readonly createdAt: string;
}

export interface TenantStaffReader {
  read(tenantId: VerifiedTenantId): Promise<readonly TenantStaffMember[]>;
}
