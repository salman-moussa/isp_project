import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@isp/ui/theme.css';
import './app.css';
import { AuthenticationGate } from '@isp/ui';
import { App } from './App';

const runtimeWindow = window as typeof window & {
  readonly __ORVEX_CONFIG__?: { readonly apiBaseUrl?: string };
};
const apiBaseUrl = (runtimeWindow.__ORVEX_CONFIG__?.apiBaseUrl ?? window.location.origin).replace(
  /\/$/u,
  '',
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthenticationGate audience="tenant" apiBaseUrl={apiBaseUrl}>
      {(session) => <App session={session} />}
    </AuthenticationGate>
  </StrictMode>,
);
