export interface AuditEvent {
  readonly tenantId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly result: 'allowed' | 'denied' | 'failed';
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}

export class MemoryAuditWriter implements AuditWriter {
  public readonly events: AuditEvent[] = [];

  public async append(event: AuditEvent): Promise<void> {
    this.events.push(Object.freeze({ ...event }));
  }
}
