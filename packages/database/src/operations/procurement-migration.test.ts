import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = await readFile(
  resolve(import.meta.dirname, '../../migrations/202609021811_tenant_procurement_receiving.sql'),
  'utf8',
);

describe('governed procurement and receiving migration', () => {
  it('separates catalog execution from MFA-gated accounting approval authority', () => {
    expect(migration).toContain("c.permission<>'tenant.catalog.manage'");
    expect(migration).toContain("c.permission<>'tenant.accounting.post'");
    expect(migration).toContain('c.support_grant_id IS NOT NULL');
    expect(migration).toContain('procurement_order_scope_allows(c.tenant_id,po.id,po.branch_id)');
  });

  it('makes receipts serialized, versioned, idempotent, and append-only', () => {
    expect(migration).toContain('receipt must account for every outstanding serialized unit');
    expect(migration).toContain("po.version<>(payload->>'expectedVersion')::integer");
    expect(migration).toContain('UNIQUE(tenant_id,idempotency_key)');
    expect(migration).toContain('procurement_event_immutable');
  });

  it('posts a balanced inventory versus accounts-payable journal', () => {
    expect(migration).toContain("'inventory_receipt'");
    expect(migration).toContain("'1300','Inventory USD'");
    expect(migration).toContain("'2100'");
    expect(migration).toContain('debit_minor');
    expect(migration).toContain('credit_minor');
  });
});
