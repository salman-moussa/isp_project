export interface SecurityAuditEvent {
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly claimedTenantId?: string;
  readonly supportGrantId?: string;
  readonly action: string;
  readonly reason: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface SecurityAuditWriter {
  append(event: SecurityAuditEvent): Promise<void>;
}

export class MemorySecurityAuditWriter implements SecurityAuditWriter {
  public readonly events: SecurityAuditEvent[] = [];

  public async append(event: SecurityAuditEvent): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
  }
}
