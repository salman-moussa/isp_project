import type { TenantSummary, VerifiedTenantId } from '@isp/contracts';

export interface TenantSummaryReader {
  read(tenantId: VerifiedTenantId, at: Date): Promise<TenantSummary>;
}

export class DemoTenantSummaryReader implements TenantSummaryReader {
  public async read(tenantId: VerifiedTenantId, at: Date): Promise<TenantSummary> {
    return {
      tenantId,
      asOf: at.toISOString(),
      activeSubscribers: 0,
      onlineSubscribers: 0,
      collections: { USD: 0, LBP: 0 },
    };
  }
}
