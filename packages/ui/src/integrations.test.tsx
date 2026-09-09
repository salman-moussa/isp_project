// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCompletion } from './authentication';
import { IntegrationSettingsPanel, type IntegrationSettingView } from './integrations';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const configuredSmtp: IntegrationSettingView = {
  kind: 'smtp',
  version: 2,
  active: true,
  config: {
    host: 'smtp.example.test',
    port: 587,
    security: 'starttls',
    username: 'mailer',
    fromAddress: 'noreply@example.test',
  },
  secretConfigured: true,
  protectedFields: ['password'],
  updatedBy: 'admin',
  updatedAt: '2026-09-07T10:00:00.000Z',
  lastTestStatus: 'passed',
  lastTestAt: '2026-09-07T10:05:00.000Z',
  lastTestMessage: 'Test email accepted by smtp.example.test: 250 queued',
};

describe('IntegrationSettingsPanel', () => {
  it('submits a new SMTP configuration with write-only secrets and a reason', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <IntegrationSettingsPanel
        locale="en"
        scope="platform"
        state="ready"
        settings={[]}
        events={[]}
        deliveries={[]}
        evidenceMode="reason"
        busy={false}
        onSave={onSave}
        onTest={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
    await user.type(screen.getByLabelText('SMTP host'), 'smtp.example.test');
    await user.type(screen.getByLabelText('Port'), '587');
    await user.type(screen.getByLabelText('Username'), 'mailer');
    await user.type(screen.getByLabelText('Password'), 'top-secret');
    await user.type(screen.getByLabelText('From address'), 'noreply@example.test');
    const [saveForm] = Array.from(document.querySelectorAll('form'));
    await user.type(
      within(saveForm as HTMLElement).getByLabelText('Reason (audit)'),
      'Enable verification mail',
    );
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(onSave).toHaveBeenCalledWith({
      kind: 'smtp',
      config: {
        host: 'smtp.example.test',
        port: 587,
        security: 'starttls',
        username: 'mailer',
        fromAddress: 'noreply@example.test',
      },
      secrets: { password: 'top-secret' },
      keepSecrets: false,
      active: true,
      evidence: { reason: 'Enable verification mail' },
    });
  });

  it('keeps the stored credential by default, never pre-fills it, and sends tests', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onTest = vi.fn();
    render(
      <IntegrationSettingsPanel
        locale="en"
        scope="tenant"
        state="ready"
        settings={[configuredSmtp]}
        events={[
          {
            id: 'e1',
            kind: 'smtp',
            version: 2,
            action: 'configure',
            actorId: 'admin',
            reason: 'Rotated password',
            reasonAr: 'تدوير كلمة المرور',
            secretChanged: true,
            occurredAt: '2026-09-07T10:00:00.000Z',
          },
        ]}
        evidenceMode="bilingual"
        busy={false}
        onSave={onSave}
        onTest={onTest}
      />,
    );
    const password = screen.getByLabelText('Password');
    expect(password).toHaveValue('');
    expect(password).toHaveAttribute('placeholder', '••••••••');
    expect(screen.getByText('Stored (password)')).toBeInTheDocument();
    expect(screen.getByText('Configured (credential changed)')).toBeInTheDocument();
    const [saveForm, testForm] = Array.from(document.querySelectorAll('form'));
    const save = within(saveForm as HTMLElement);
    await user.type(save.getByLabelText('Reason (English)'), 'Adjust relay port');
    await user.type(save.getByLabelText('Reason (Arabic)'), 'تعديل منفذ المرحّل');
    await user.type(save.getByLabelText('Evidence reference'), 'Ticket CHG-2026-091');
    await user.click(screen.getByRole('button', { name: 'Save new version' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smtp',
        keepSecrets: true,
        expectedVersion: 2,
        config: expect.objectContaining({ host: 'smtp.example.test', port: 587 }) as unknown,
        evidence: {
          reasonEn: 'Adjust relay port',
          reasonAr: 'تعديل منفذ المرحّل',
          evidence: 'Ticket CHG-2026-091',
        },
      }),
    );
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('secrets');

    const test = within(testForm as HTMLElement);
    await user.type(test.getByLabelText('Recipient email'), 'owner@example.test');
    await user.type(test.getByLabelText('Reason (English)'), 'Verify after rotation');
    await user.type(test.getByLabelText('Reason (Arabic)'), 'تحقق بعد التدوير');
    await user.type(test.getByLabelText('Evidence reference'), 'Ticket CHG-2026-091');
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    expect(onTest).toHaveBeenCalledWith({
      kind: 'smtp',
      recipient: 'owner@example.test',
      evidence: {
        reasonEn: 'Verify after rotation',
        reasonAr: 'تحقق بعد التدوير',
        evidence: 'Ticket CHG-2026-091',
      },
    });
  }, 15_000);

  it('switches providers per kind and renders Arabic right-to-left', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <IntegrationSettingsPanel
        locale="ar"
        scope="tenant"
        state="ready"
        settings={[]}
        events={[]}
        evidenceMode="bilingual"
        busy={false}
        onSave={vi.fn()}
        onTest={vi.fn()}
      />,
    );
    expect(container.querySelector('.integration-panel')).toHaveAttribute('dir', 'rtl');
    await user.click(screen.getByRole('button', { name: /واتساب/u }));
    expect(screen.getByLabelText('معرّف حساب Twilio')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('المزوّد'), 'meta_cloud');
    expect(screen.getByLabelText('معرّف رقم الهاتف')).toBeInTheDocument();
    expect(screen.queryByLabelText('معرّف حساب Twilio')).not.toBeInTheDocument();
  });

  it('shows denied and error states without a form', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <IntegrationSettingsPanel
        locale="en"
        scope="platform"
        state="denied"
        settings={[]}
        events={[]}
        evidenceMode="reason"
        busy={false}
        onSave={vi.fn()}
        onTest={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Integration settings are outside your scope')).toBeInTheDocument();
    expect(screen.queryByLabelText('SMTP host')).not.toBeInTheDocument();
    rerender(
      <IntegrationSettingsPanel
        locale="en"
        scope="platform"
        state="error"
        settings={[]}
        events={[]}
        evidenceMode="reason"
        busy={false}
        onSave={vi.fn()}
        onTest={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('RecoveryCompletion', () => {
  it('posts the token with the new password and confirms success', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<RecoveryCompletion apiBaseUrl="https://api.orvex.invalid" token={'t'.repeat(40)} />);
    await user.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your password was updated');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.orvex.invalid/v1/auth/recovery/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 't'.repeat(40), newPassword: 'correct-horse-battery' }),
      }),
    );
  });

  it('refuses a mismatched confirmation before calling the API', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<RecoveryCompletion apiBaseUrl="https://api.orvex.invalid" token={'t'.repeat(40)} />);
    await user.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await user.type(screen.getByLabelText('Confirm password'), 'different-password-1');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('does not match');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
