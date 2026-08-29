import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvitationAcceptance } from './InvitationAcceptance';

afterEach(() => vi.unstubAllGlobals());

describe('InvitationAcceptance', () => {
  it('accepts the one-time token without exposing it in the rendered page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        outcome: 'created',
        tenantId: '00000000-0000-4000-8000-00000000000a',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const token = 'a'.repeat(43);
    const { container } = render(
      <InvitationAcceptance apiBaseUrl="https://api.example.test" token={token} />,
    );

    await user.type(screen.getByLabelText('New password'), 'correct horse battery staple');
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(await screen.findByText('Your employee account is ready.')).toBeVisible();
    expect(container).not.toHaveTextContent(token);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/staff-invitations/accept',
      expect.objectContaining({ method: 'POST' }),
    );
    await waitFor(async () => expect((await axe.run(container)).violations).toEqual([]));
  });
});
