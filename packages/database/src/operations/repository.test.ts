import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repositoryUrl = new URL('./repository.ts', import.meta.url);
const routeUrl = new URL(
  '../../../../apps/api/src/routes/operations/tenant-operations.ts',
  import.meta.url,
);

describe('Operations repository and API boundaries', () => {
  it('installs signed context for every repository transaction', async () => {
    const repository = await readFile(repositoryUrl, 'utf8');
    expect(repository).not.toContain('inTenantTransaction(');
    expect(repository.match(/inOperationsTransaction\(/g)?.length).toBeGreaterThanOrEqual(15);
  });

  it('selects eligible anchors and effective plan and billing-policy versions', async () => {
    const repository = await readFile(repositoryUrl, 'utf8');
    expect(repository).toContain('generate_series(');
    expect(repository).toContain('s.billing_anchor_day');
    expect(repository).toContain('operations_plan_versions version');
    expect(repository).toContain('operations_billing_policies policy');
    expect(repository).toContain('s.activated_at');
    expect(repository).toContain('s.terminated_at');
  });

  it('does not accept caller-computed VAT or collector totals', async () => {
    const route = await readFile(routeUrl, 'utf8');
    const billingSchema = route.slice(
      route.indexOf('const billingBody'),
      route.indexOf('const officePaymentBody'),
    );
    const reconciliationSchema = route.slice(
      route.indexOf('const reconciliationBody'),
      route.indexOf('const installationBody'),
    );
    expect(billingSchema).not.toContain('vatRateBasisPoints');
    expect(reconciliationSchema).not.toContain('expectedMinor');
    expect(reconciliationSchema).not.toContain('declaredMinor');
  });

  it('exposes concrete reviewed Operations mutations', async () => {
    const route = await readFile(routeUrl, 'utf8');
    for (const path of [
      '/office-payments',
      '/plan-versions',
      '/billing-policy-versions',
      '/service-installations',
      '/collector-assignments',
      '/collector-evidence',
      '/issues/transitions',
      '/configuration',
    ])
      expect(route).toContain(path);
  });
});
