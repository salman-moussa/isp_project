import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@isp/ui/theme.css';
import './app.css';
import { AuthenticationGate, RecoveryCompletion, recoveryHashPattern } from '@isp/ui';
import { App } from './App';

const runtimeWindow = window as typeof window & {
  readonly __ORVEX_CONFIG__?: { readonly apiBaseUrl?: string };
};
const apiBaseUrl = (runtimeWindow.__ORVEX_CONFIG__?.apiBaseUrl ?? window.location.origin).replace(
  /\/$/u,
  '',
);

const recoveryMatch = recoveryHashPattern.exec(window.location.hash);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {recoveryMatch ? (
      <RecoveryCompletion
        apiBaseUrl={apiBaseUrl}
        token={recoveryMatch[1]}
        onDone={() => window.location.reload()}
      />
    ) : (
      <AuthenticationGate audience="platform" apiBaseUrl={apiBaseUrl}>
        {(session) => <App session={session} />}
      </AuthenticationGate>
    )}
  </StrictMode>,
);
