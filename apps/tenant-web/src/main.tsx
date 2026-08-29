import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@isp/ui/theme.css';
import './app.css';
import { AuthenticationGate } from '@isp/ui';
import { App } from './App';
import { InvitationAcceptance } from './staff/InvitationAcceptance';

const runtimeWindow = window as typeof window & {
  readonly __ORVEX_CONFIG__?: { readonly apiBaseUrl?: string };
};
const apiBaseUrl = (runtimeWindow.__ORVEX_CONFIG__?.apiBaseUrl ?? window.location.origin).replace(
  /\/$/u,
  '',
);

const invitationMatch = /^#\/staff-invitation\/([A-Za-z0-9_-]{32,512})$/u.exec(
  window.location.hash,
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {invitationMatch ? (
      <InvitationAcceptance apiBaseUrl={apiBaseUrl} token={invitationMatch[1]!} />
    ) : (
      <AuthenticationGate audience="tenant" apiBaseUrl={apiBaseUrl}>
        {(session) => <App session={session} />}
      </AuthenticationGate>
    )}
  </StrictMode>,
);
