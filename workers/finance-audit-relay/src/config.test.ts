import { describe, expect, it } from 'vitest';
import { readRelayConfig } from './config.js';

const tenantId = '00000000-0000-4000-8000-000000000001';

describe('finance audit relay configuration', () => {
  it('keeps control and tenant database credentials in separate required settings', () => {
    const config = readRelayConfig({
      FINANCE_AUDIT_CONTROL_DATABASE_URL: 'postgresql://control:secret@control/control',
      FINANCE_AUDIT_TENANTS_JSON: JSON.stringify([
        { tenantId, databaseUrl: 'postgresql://tenant:secret@tenant/tenant' },
      ]),
    });
    expect(config.controlDatabaseUrl).toContain('/control');
    expect(config.tenants).toEqual([
      { tenantId, databaseUrl: 'postgresql://tenant:secret@tenant/tenant' },
    ]);
  });

  it('rejects duplicate tenant identities and non-PostgreSQL endpoints', () => {
    expect(() =>
      readRelayConfig({
        FINANCE_AUDIT_CONTROL_DATABASE_URL: 'postgresql://control/control',
        FINANCE_AUDIT_TENANTS_JSON: JSON.stringify([
          { tenantId, databaseUrl: 'postgresql://tenant/one' },
          { tenantId, databaseUrl: 'postgresql://tenant/two' },
        ]),
      }),
    ).toThrow(/duplicates/u);
    expect(() =>
      readRelayConfig({
        FINANCE_AUDIT_CONTROL_DATABASE_URL: 'https://not-a-database.example',
        FINANCE_AUDIT_TENANTS_JSON: '[]',
      }),
    ).toThrow(/PostgreSQL protocol/u);
  });
});
