import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ControlCenterWorkspace, type ControlCenterWorkspaceProps } from './ControlCenterWorkspace';
const base: ControlCenterWorkspaceProps = {
  locale: 'en',
  viewState: 'ready',
  clients: [
    {
      id: 'c1',
      tradingName: 'North ISP',
      legalName: 'North ISP SARL',
      state: 'active',
      packageName: 'ISP Pro v2',
      deploymentHealth: 'attention',
      supportStatus: 'open',
      openTicketCount: 2,
    },
  ],
  onApplyFilters: vi.fn(),
  onOpenClient: vi.fn(),
  onAddClient: vi.fn(),
  onRetry: vi.fn(),
  onOpenAudit: vi.fn(),
};
describe('ControlCenterWorkspace', () => {
  it('runs filters and client tasks', async () => {
    const user = userEvent.setup();
    const onApplyFilters = vi.fn();
    const onOpenClient = vi.fn();
    render(
      <ControlCenterWorkspace
        {...base}
        onApplyFilters={onApplyFilters}
        onOpenClient={onOpenClient}
      />,
    );
    await user.type(screen.getByRole('searchbox'), 'North');
    await user.selectOptions(screen.getByLabelText('Lifecycle state'), 'active');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(onApplyFilters).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'North', state: 'active' }),
    );
    await user.click(screen.getByRole('button', { name: 'Open workspace' }));
    expect(onOpenClient).toHaveBeenCalledWith('c1');
  });
  it('renders correct RTL Arabic labels and a non-escalating denial control', () => {
    const { container } = render(
      <ControlCenterWorkspace {...base} locale="ar" viewState="denied" clients={[]} />,
    );
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
    expect(screen.getByText('ليس لديك صلاحية لعرض سجلات العملاء')).toBeInTheDocument();
    expect(screen.getByText(/لا يمكن لهذه الشاشة طلب الصلاحيات/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /صلاحية/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إضافة عميل مزوّد' })).not.toBeInTheDocument();
  });
  it('localizes enum values rather than exposing English codes in Arabic', () => {
    render(<ControlCenterWorkspace {...base} locale="ar" />);
    expect(screen.getAllByText('نشط')).not.toHaveLength(0);
    expect(screen.getAllByText('يحتاج متابعة')).not.toHaveLength(0);
    expect(screen.getByRole('option', { name: 'عميل محتمل' })).toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });
});
