import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityWorkspace as Workspace, CircuitRecord } from '@isp/contracts';
import type { ApiSession } from '@isp/ui';

const { readCapacityWorkspace, submitTenantOperation } = vi.hoisted(() => ({
  readCapacityWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submitTenantOperation: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(),
}));
vi.mock('../api', () => ({ readCapacityWorkspace, submitTenantOperation }));

const { CapacityWorkspace } = await import('./CapacityWorkspace');

const session: ApiSession = {
  accessToken: 'token',
  refreshToken: 'refresh',
  tenantId: '00000000-0000-4000-8000-000000000001',
  apiBaseUrl: 'https://api.orvex.invalid',
  logout: () => undefined,
};
const circuit = (overrides: Partial<CircuitRecord>): CircuitRecord => ({
  id: '10000000-0000-4000-8000-000000000001',
  code: 'TRANSIT-BEY-1',
  provider: 'Upstream provider',
  kind: 'transit',
  pop: 'Beirut POP',
  branchId: null,
  branchName: null,
  committedMbps: 1000,
  burstMbps: 1200,
  monthlyCostMinor: 450000,
  currency: 'USD',
  contractStart: '2026-01-01',
  contractEnd: '2026-10-01',
  renewalNoticeDays: 60,
  slaAvailabilityPct: 99.9,
  status: 'active',
  notes: null,
  version: 3,
  daysToContractEnd: 21,
  renewalDue: true,
  latestSample: {
    sampledAt: '2026-09-09T20:00:00.000Z',
    peakInMbps: 920,
    peakOutMbps: 310,
  },
  peakMbps: 920,
  samples: 3,
  utilisationPct: 92,
  headroomMbps: 80,
  risk: 'critical',
  growthMbpsPerMonth: 40,
  monthsToSaturation: 2,
  trend: [
    { sampledAt: '2026-09-07T20:00:00.000Z', peakMbps: 840 },
    { sampledAt: '2026-09-08T20:00:00.000Z', peakMbps: 880 },
    { sampledAt: '2026-09-09T20:00:00.000Z', peakMbps: 920 },
  ],
  ...overrides,
});
const workspace: Workspace = {
  asOf: '2026-09-10T08:00:00.000Z',
  windowDays: 30,
  circuits: [
    circuit({}),
    circuit({
      id: '10000000-0000-4000-8000-000000000002',
      code: 'OGERO-TRP-2',
      kind: 'ogero_fiber',
      committedMbps: 500,
      burstMbps: null,
      currency: 'LBP',
      monthlyCostMinor: 90000000,
      contractEnd: null,
      daysToContractEnd: null,
      renewalDue: false,
      peakMbps: null,
      latestSample: null,
      samples: 0,
      utilisationPct: null,
      headroomMbps: null,
      risk: 'unknown',
      growthMbpsPerMonth: null,
      monthsToSaturation: null,
      trend: [],
      version: 1,
    }),
  ],
  cost: [
    { currency: 'LBP', monthlyMinor: 90000000, circuits: 1 },
    { currency: 'USD', monthlyMinor: 450000, circuits: 1 },
  ],
  totals: { committedMbps: 1500, active: 2, planned: 0, decommissioned: 0 },
  branches: [{ id: '20000000-0000-4000-8000-000000000001', nameEn: 'Tripoli', nameAr: 'طرابلس' }],
};

describe('CapacityWorkspace', () => {
  beforeEach(() => {
    readCapacityWorkspace.mockReset();
    submitTenantOperation.mockReset();
    readCapacityWorkspace.mockResolvedValue(workspace);
    submitTenantOperation.mockResolvedValue({ circuitId: 'x', recorded: 1 });
  });

  it('shows committed capacity, saturation risk and renewals from the workspace', async () => {
    render(<CapacityWorkspace locale="en" session={session} />);
    expect(await screen.findByText('TRANSIT-BEY-1')).toBeInTheDocument();
    expect(screen.getByText('Committed capacity').nextElementSibling).toHaveTextContent(
      '1,500 Mbps',
    );
    expect(screen.getByText('Saturation risk').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Renewals due').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Saturating')).toBeInTheDocument();
    expect(screen.getByText('No samples')).toBeInTheDocument();
    expect(screen.getByLabelText('92%')).toBeInTheDocument();
    expect(readCapacityWorkspace).toHaveBeenCalledWith(session, { days: 30 });
  });

  it('records a utilisation sample for a circuit, in Arabic', async () => {
    const user = userEvent.setup();
    const { container } = render(<CapacityWorkspace locale="ar" session={session} />);
    expect(await screen.findByText('TRANSIT-BEY-1')).toBeInTheDocument();
    expect(container.querySelector('.reg-shell')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getAllByRole('button', { name: 'عينة' })[0]);
    await user.clear(screen.getByLabelText('وقت العينة'));
    await user.type(screen.getByLabelText('وقت العينة'), '2026-09-10T21:00');
    await user.type(screen.getByLabelText('ذروة الوارد (Mbps)'), '950');
    await user.type(screen.getByLabelText('ذروة الصادر (Mbps)'), '300');
    await user.click(screen.getByRole('button', { name: 'تسجيل العينة' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'capacity/commands',
        {
          command: {
            action: 'record_samples',
            circuitId: '10000000-0000-4000-8000-000000000001',
            source: 'manual',
            samples: [
              {
                sampledAt: new Date('2026-09-10T21:00').toISOString(),
                peakInMbps: 950,
                peakOutMbps: 300,
              },
            ],
          },
        },
        expect.stringMatching(/^web-capacity-/u),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('سُجلت العينة.');
  });

  it('adds a circuit with its committed capacity and contract, converting USD to minor units', async () => {
    const user = userEvent.setup();
    render(<CapacityWorkspace locale="en" session={session} />);
    await user.click(await screen.findByRole('button', { name: 'Add circuit' }));
    await user.type(screen.getByLabelText('Code'), 'peer-bey-3');
    await user.type(screen.getByLabelText('Provider'), 'Exchange partner');
    await user.selectOptions(screen.getByLabelText('Kind'), 'peering');
    await user.type(screen.getByLabelText('Point of presence'), 'Beirut POP');
    await user.selectOptions(
      screen.getByLabelText('Branch'),
      '20000000-0000-4000-8000-000000000001',
    );
    await user.type(screen.getByLabelText('Committed Mbps'), '2000');
    await user.type(screen.getByLabelText('Monthly cost'), '1250.5');
    await user.type(screen.getByLabelText('Contract end'), '2027-03-31');
    await user.click(screen.getByRole('button', { name: 'Save circuit' }));
    await waitFor(() =>
      expect(submitTenantOperation).toHaveBeenCalledWith(
        session,
        'capacity/commands',
        {
          command: {
            action: 'upsert_circuit',
            code: 'PEER-BEY-3',
            provider: 'Exchange partner',
            kind: 'peering',
            pop: 'Beirut POP',
            branchId: '20000000-0000-4000-8000-000000000001',
            committedMbps: 2000,
            burstMbps: null,
            monthlyCostMinor: 125050,
            currency: 'USD',
            contractEnd: '2027-03-31',
            renewalNoticeDays: 60,
            slaAvailabilityPct: null,
            status: 'active',
            notes: '',
          },
        },
        expect.any(String),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Circuit recorded.');
  });
});
