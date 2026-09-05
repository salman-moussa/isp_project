import { describe, expect, it } from 'vitest';
import { comparePlan, computePackagedChecksums } from '../scripts/preflight-migrations.mjs';

const packaged = (entries: [string, string][]) => new Map(entries);

describe('migration preflight comparison', () => {
  it('accepts a ledger whose applied migrations match the packaged bytes', () => {
    const report = comparePlan(
      packaged([
        ['202609021810_tenant_inventory_custody.sql', 'aaa'],
        ['202609021811_tenant_procurement_receiving.sql', 'bbb'],
      ]),
      [
        { name: '202609021810_tenant_inventory_custody.sql', checksum: 'aaa' },
        { name: '202609021811_tenant_procurement_receiving.sql', checksum: 'bbb' },
      ],
    );

    expect(report.blocking).toEqual([]);
    expect(report.matched).toBe(2);
    expect(report.pending).toEqual([]);
  });

  it('promotes only new forward migrations and leaves applied history untouched', () => {
    const report = comparePlan(
      packaged([
        ['202609021811_tenant_procurement_receiving.sql', 'bbb'],
        ['202609050900_tenant_warehouse_admin.sql', 'ccc'],
      ]),
      [{ name: '202609021811_tenant_procurement_receiving.sql', checksum: 'bbb' }],
    );

    expect(report.blocking).toEqual([]);
    expect(report.pending).toEqual(['202609050900_tenant_warehouse_admin.sql']);
    expect(report.lastApplied).toBe('202609021811_tenant_procurement_receiving.sql');
  });

  it('blocks a line-ending regression that leaves content identical but checksums different', () => {
    const report = comparePlan(
      packaged([['202609021811_tenant_procurement_receiving.sql', 'crlf-checksum']]),
      [{ name: '202609021811_tenant_procurement_receiving.sql', checksum: 'lf-checksum' }],
    );

    expect(report.blocking).toMatchObject([
      { kind: 'checksum_mismatch', name: '202609021811_tenant_procurement_receiving.sql' },
    ]);
    expect(report.matched).toBe(0);
  });

  it('blocks an artifact that dropped a migration production has already applied', () => {
    const report = comparePlan(packaged([['0000_identity_tenancy_audit.sql', 'aaa']]), [
      { name: '0000_identity_tenancy_audit.sql', checksum: 'aaa' },
      { name: '202609021811_tenant_procurement_receiving.sql', checksum: 'bbb' },
    ]);

    expect(report.blocking).toMatchObject([
      { kind: 'applied_missing_locally', name: '202609021811_tenant_procurement_receiving.sql' },
    ]);
  });

  it('blocks a new migration that would replay before already-applied schema changes', () => {
    const report = comparePlan(
      packaged([
        ['202608010000_backdated_change.sql', 'zzz'],
        ['202609021811_tenant_procurement_receiving.sql', 'bbb'],
      ]),
      [{ name: '202609021811_tenant_procurement_receiving.sql', checksum: 'bbb' }],
    );

    expect(report.blocking).toMatchObject([
      { kind: 'pending_out_of_order', name: '202608010000_backdated_change.sql' },
    ]);
  });

  it('treats an empty ledger as a first deployment rather than a blocking failure', () => {
    const report = comparePlan(packaged([['0000_identity_tenancy_audit.sql', 'aaa']]), []);

    expect(report.blocking).toEqual([]);
    expect(report.pending).toEqual(['0000_identity_tenancy_audit.sql']);
  });

  it('computes checksums over the real packaged tenant migrations', async () => {
    const checksums = await computePackagedChecksums('tenant');

    expect(checksums.size).toBeGreaterThan(0);
    for (const [name, checksum] of checksums) {
      expect(name.endsWith('.sql')).toBe(true);
      expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
