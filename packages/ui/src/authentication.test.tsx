// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationGate } from './authentication';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('AuthenticationGate', () => {
  it('completes login and MFA without exposing a production fixture session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'mfa_required',
            challengeId: '10000000-0000-4000-8000-000000000001',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'authenticated',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <AuthenticationGate audience="platform" apiBaseUrl="https://api.orvex.invalid">
        {(session) => <p>Connected: {session.accessToken}</p>}
      </AuthenticationGate>,
    );

    await user.type(screen.getByLabelText(/Email/u), 'operator@orvex.invalid');
    await user.type(screen.getByLabelText(/Password/u), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /Sign in/u }));
    await user.type(await screen.findByLabelText(/Verification code/u), '123456');
    await user.click(screen.getByRole('button', { name: /Verify/u }));

    expect(await screen.findByText('Connected: access-token')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('orvex.session.platform')).not.toContain('correct horse');
  });

  it('replaces the web session after an authenticated MFA step-up', async () => {
    sessionStorage.setItem(
      'orvex.session.tenant',
      JSON.stringify({
        status: 'authenticated',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      }),
    );
    sessionStorage.setItem('orvex.session.tenant.tenant', '00000000-0000-4000-8000-00000000000a');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'mfa_required',
            challengeId: '10000000-0000-4000-8000-000000000001',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'authenticated',
            accessToken: 'step-up-access',
            refreshToken: 'step-up-refresh',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <AuthenticationGate audience="tenant" apiBaseUrl="https://api.orvex.invalid">
        {(session) => (
          <div>
            <p>{session.accessToken}</p>
            <button
              onClick={() => {
                void session
                  .startMfaStepUp?.()
                  .then((challenge) =>
                    session.completeMfaStepUp?.(challenge.challengeId, '123456'),
                  );
              }}
            >
              Step up
            </button>
          </div>
        )}
      </AuthenticationGate>,
    );

    await user.click(screen.getByRole('button', { name: 'Step up' }));
    expect(await screen.findByText('step-up-access')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.orvex.invalid/v1/auth/mfa/step-up',
      expect.objectContaining({ headers: { authorization: 'Bearer old-access' } }),
    );
  });
});
