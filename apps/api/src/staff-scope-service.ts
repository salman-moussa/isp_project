import type { AuthorizationScope, VerifiedTenantId } from '@isp/contracts';
import {
  readOperationsScopeCatalogue,
  signOperationsAttestation,
  TenantStaffValidationError,
  type Database,
  type OperationsAttestation,
  type OperationsScopeCatalogue,
} from '@isp/database';
import type { OperationsContextAuthorityConfig } from './operations-service.js';

export interface StaffScopeActor {
  readonly actorId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
}

export interface TenantStaffScopeService {
  read(tenantId: VerifiedTenantId, actor: StaffScopeActor): Promise<OperationsScopeCatalogue>;
  assertValid(
    tenantId: VerifiedTenantId,
    scope: AuthorizationScope,
    actor: StaffScopeActor,
  ): Promise<void>;
}

export class PostgresTenantStaffScopeService implements TenantStaffScopeService {
  public constructor(
    private readonly database: Database,
    private readonly authority: OperationsContextAuthorityConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public read(tenantId: VerifiedTenantId, actor: StaffScopeActor) {
    return readOperationsScopeCatalogue(this.database, tenantId, this.sign(tenantId, actor));
  }

  public async assertValid(
    tenantId: VerifiedTenantId,
    scope: AuthorizationScope,
    actor: StaffScopeActor,
  ): Promise<void> {
    const catalogue = await this.read(tenantId, actor);
    assertKnown(scope.branchIds, catalogue.branches, 'branch');
    assertKnown(scope.areaIds, catalogue.areas, 'area');
    assertKnown(scope.routeIds, catalogue.routes, 'route');
    if (scope.recordIds?.length)
      throw new TenantStaffValidationError('Record-scoped staff roles are not supported.');
  }

  private sign(tenantId: VerifiedTenantId, actor: StaffScopeActor) {
    const attestation: OperationsAttestation = {
      keyId: this.authority.keyId,
      tenantId,
      actorId: actor.actorId,
      sessionId: actor.sessionId,
      permission: 'tenant.user.administer',
      action: 'tenant.staff.scope.read',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      reason: 'Validate governed tenant staff authorization scope',
      idempotencyKey: `staff-scope-${actor.requestId}`,
      expiresAt: new Date(this.now().getTime() + 60_000).toISOString(),
    };
    return signOperationsAttestation(attestation, this.authority.secret);
  }
}

function assertKnown(
  selected: readonly string[] | undefined,
  catalogue: readonly { readonly id: string }[],
  kind: string,
) {
  if (!selected?.length) return;
  const allowed = new Set(catalogue.map((item) => item.id));
  if (selected.some((id) => !allowed.has(id))) {
    throw new TenantStaffValidationError(
      `The selected ${kind} scope is not active in this tenant.`,
    );
  }
}
