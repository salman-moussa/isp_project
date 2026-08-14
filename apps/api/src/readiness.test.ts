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
          operations_ready: true,
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
    expect(query).toContain('202608112200_tenant_operations_core.sql');
    expect(query).toContain('202608112300_tenant_collect_sync.sql');
    expect(query).toContain('collect_devices');
    expect(query).toContain('operations_readiness');
  });

  it('fails closed when the finance guard invariant is absent', async () => {
    const client = {
      unsafe: vi.fn(async () => [
        {
          relations_ready: true,
          migrations_ready: true,
          guard_and_outbox_invariants_ready: false,
          operations_ready: true,
        },
      ]),
    } as unknown as TenantClient;
    await expect(assertTenantDatabaseReady(client)).rejects.toThrow('guard invariant');
  });

  it('keeps the control-plane security audit migration in its readiness gate', async () => {
    let query = '';
    const client = {
      begin: vi.fn(async (work: (transaction: { unsafe: typeof unsafe }) => Promise<unknown>) =>
        work({ unsafe }),
      ),
    } as unknown as ControlClient;
    async function unsafe(statement: string) {
      query += statement;
      if (statement.startsWith('SET LOCAL')) return [];
      if (statement.includes('auth_readiness')) {
        return [{ relations_ready: true, migration_ready: true, functions_ready: true }];
      }
      return [
        {
          relations_ready: true,
          migrations_ready: true,
          runtime_role_ready: true,
          context_key_ready: true,
          privileges_ready: true,
        },
      ];
    }
    await expect(assertControlDatabaseReady(client)).resolves.toBeUndefined();
    expect(query).toContain('SET LOCAL ROLE orvex_control_runtime');
    expect(query).toContain('control_center_readiness');
    expect(query).toContain('auth_readiness');
  });

  it('fails control readiness closed when no active signing key is installed', async () => {
    const client = {
      begin: vi.fn(async (work: (transaction: { unsafe: typeof unsafe }) => Promise<unknown>) =>
        work({ unsafe }),
      ),
    } as unknown as ControlClient;
    async function unsafe(statement: string) {
      if (statement.startsWith('SET LOCAL')) return [];
      if (statement.includes('auth_readiness')) {
        return [{ relations_ready: true, migration_ready: true, functions_ready: true }];
      }
      return [
        {
          relations_ready: true,
          migrations_ready: true,
          runtime_role_ready: true,
          context_key_ready: false,
          privileges_ready: true,
        },
      ];
    }
    await expect(assertControlDatabaseReady(client)).rejects.toThrow('Control database schema');
  });
});
