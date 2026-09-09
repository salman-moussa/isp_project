import { z } from 'zod';

// Live operations dashboard and governed report datasets. Every figure is computed from the
// tenant's own records at read time; money always carries its currency and is never combined.

export interface DashboardSnapshot {
  readonly asOf: string;
  readonly collections: {
    readonly usdMinor: number;
    readonly lbpMinor: number;
    readonly receipts: number;
    readonly byChannel: readonly {
      channel: 'office' | 'collector' | 'other';
      currency: 'USD' | 'LBP';
      amountMinor: number;
      receipts: number;
    }[];
    readonly recent: readonly {
      receiptNumber: string;
      currency: 'USD' | 'LBP';
      amountMinor: number;
      channel: 'office' | 'collector' | 'other';
      subscriberName: string | null;
      postedAt: string;
    }[];
  };
  readonly receivables: {
    readonly unpaidInvoices: number;
    readonly overdue30: number;
    readonly usdMinor: number;
    readonly lbpMinor: number;
    readonly oldest: readonly {
      documentNumber: string;
      currency: 'USD' | 'LBP';
      remainingMinor: number;
      subscriberName: string | null;
      postedAt: string;
    }[];
  };
  readonly services: {
    readonly active: number;
    readonly suspended: number;
    readonly pendingInstallation: number;
    readonly liveSessions: number;
    readonly byNas: readonly { nasName: string; sessions: number }[];
  };
  readonly work: {
    readonly failedJobs: number;
    readonly openTickets: number;
    readonly ticketsOverdue: number;
    readonly openIncidents: number;
    readonly workOrdersToday: number;
    readonly failed: readonly {
      kind: 'network' | 'notification' | 'billing' | 'alarm';
      reference: string;
      detail: string;
      at: string;
    }[];
  };
  readonly activity: readonly {
    action: string;
    resourceType: string;
    actor: string;
    at: string;
    result: string;
  }[];
}

export const reportKeys = [
  'ar_aging',
  'collections_daily',
  'subscriber_status',
  'plan_mix',
  'ticket_sla',
  'incidents',
  'dealer_float',
  'assurance_exposure',
  'notification_delivery',
] as const;
export type ReportKey = (typeof reportKeys)[number];

export const reportQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportExportSchema = z
  .object({
    key: z.enum(reportKeys),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    format: z.literal('csv').default('csv'),
  })
  .strict();
export type ReportExportCommand = z.infer<typeof reportExportSchema>;

export interface ReportDataset {
  readonly key: ReportKey;
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly rows: readonly Record<string, unknown>[];
}

export interface ReportExportJob {
  readonly id: string;
  readonly reportKey: string;
  readonly format: string;
  readonly status: string;
  readonly rows: number | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
}

export interface ReportsWorkspace {
  readonly catalogue: readonly {
    key: ReportKey;
    windowed: boolean;
  }[];
  readonly exports: readonly ReportExportJob[];
}
