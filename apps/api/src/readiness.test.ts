import { describe, expect, it, vi } from 'vitest';
import { assertControlDatabaseReady, assertTenantDatabaseReady } from './readiness.js';

type ControlClient = Parameters<typeof assertControlDatabaseReady>[0];
type TenantClient = Parameters<typeof assertTenantDatabaseReady>[0];

describe('database readiness', () => {
  it('requires the current tenant finance migration, relations, and guard triggers', async () => {
    let query = '';
    const unsafe = vi.fn(async (statement: string) => {
      query = statement;
      return [
        {
          relations_ready: true,
          migrations_ready: true,
          guard_and_outbox_invariants_ready: true,
        },
      ];
    });
    await expect(
      assertTenantDatabaseReady({ unsafe } as unknown as TenantClient),
    ).resolves.toBeUndefined();
    expect(query).toContain('202608111700_finance_audit_relay_security.sql');
    expect(query).toContain('finance_document_guards');
    expect(query).toContain('finance_allocations_maintain_guards');
    expect(query).toContain('orvex_finance_audit_relay_owner');
    expect(query).toContain('list_finance_audit_relay_tenants');
  });

  it('fails closed when the finance guard invariant is absent', async () => {
    const client = {
      unsafe: vi.fn(async () => [
        {
          relations_ready: true,
          migrations_ready: true,
          guard_and_outbox_invariants_ready: false,
        },
      ]),
    } as unknown as TenantClient;
    await expect(assertTenantDatabaseReady(client)).rejects.toThrow('guard invariant');
  });

  it('keeps the control-plane security audit migration in its readiness gate', async () => {
    const client = {
      unsafe: vi.fn(async () => [{ relations_ready: true, migrations_ready: true }]),
    } as unknown as ControlClient;
    await expect(assertControlDatabaseReady(client)).resolves.toBeUndefined();
  });
});
