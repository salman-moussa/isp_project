import { useState, type FormEvent, type ReactNode } from 'react';

export interface ApiSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tenantId?: string;
  readonly apiBaseUrl: string;
  readonly logout: () => void;
}

interface SessionTokens {
  readonly status: 'authenticated';
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface MfaChallenge {
  readonly status: 'mfa_required';
  readonly challengeId: string;
}

export function AuthenticationGate(props: {
  readonly audience: 'platform' | 'tenant';
  readonly apiBaseUrl: string;
  readonly children: (session: ApiSession) => ReactNode;
}) {
  const storageKey = `orvex.session.${props.audience}`;
  const [stored, setStored] = useState<SessionTokens | null>(() => readSession(storageKey));
  const [tenantId, setTenantId] = useState(
    () => sessionStorage.getItem(`${storageKey}.tenant`) ?? '',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const logout = () => {
    sessionStorage.removeItem(storageKey);
    setStored(null);
  };
  if (stored) {
    return props.children({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      ...(props.audience === 'tenant' ? { tenantId } : {}),
      apiBaseUrl: props.apiBaseUrl,
      logout,
    });
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const path = challengeId ? '/v1/auth/mfa/verify' : '/v1/auth/login';
      const body = challengeId
        ? { challengeId, code, deviceLabel: 'Web browser' }
        : {
            email,
            password,
            audience: props.audience,
            ...(props.audience === 'tenant' ? { tenantId } : {}),
            deviceLabel: 'Web browser',
          };
      const response = await fetch(`${props.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as
        | SessionTokens
        | MfaChallenge
        | {
            error?: { message?: string };
          };
      if (!response.ok) throw new Error('error' in payload ? payload.error?.message : undefined);
      if ('status' in payload && payload.status === 'mfa_required') {
        setChallengeId(payload.challengeId);
        return;
      }
      if (!('status' in payload) || payload.status !== 'authenticated') {
        throw new Error('The authentication response was invalid.');
      }
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
      if (props.audience === 'tenant') sessionStorage.setItem(`${storageKey}.tenant`, tenantId);
      setStored(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-gate">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <p className="auth-card__eyebrow">Orvex ISP · أورفكس</p>
        <h1>{challengeId ? 'Verify MFA · تأكيد التحقق' : 'Sign in · تسجيل الدخول'}</h1>
        <p>{props.audience === 'platform' ? 'Orvex ISP Control Center' : 'Orvex ISP Operations'}</p>
        {challengeId ? (
          <label>
            Verification code · رمز التحقق
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              minLength={6}
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              Email · البريد الإلكتروني
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password · كلمة المرور
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {props.audience === 'tenant' ? (
              <label>
                Workspace ID · معرّف مساحة العمل
                <input
                  required
                  pattern="[0-9a-fA-F-]{36}"
                  value={tenantId}
                  onChange={(event) => setTenantId(event.target.value)}
                />
              </label>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="auth-card__error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : challengeId ? 'Verify · تأكيد' : 'Sign in · دخول'}
        </button>
      </form>
    </main>
  );
}

function readSession(key: string): SessionTokens | null {
  try {
    const value = sessionStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SessionTokens>;
    return parsed.status === 'authenticated' &&
      typeof parsed.accessToken === 'string' &&
      typeof parsed.refreshToken === 'string'
      ? (parsed as SessionTokens)
      : null;
  } catch {
    return null;
  }
}
