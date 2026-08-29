import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

export interface ApiSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tenantId?: string;
  readonly apiBaseUrl: string;
  readonly logout: () => void;
  readonly startMfaStepUp?: () => Promise<MfaChallenge>;
  readonly completeMfaStepUp?: (challengeId: string, code: string) => Promise<void>;
}

interface SessionTokens {
  readonly status: 'authenticated';
  readonly accessToken: string;
  readonly accessExpiresAt?: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt?: string;
  readonly sessionId?: string;
}

interface MfaChallenge {
  readonly status: 'mfa_required';
  readonly challengeId: string;
  readonly expiresAt?: string;
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
  const [showPassword, setShowPassword] = useState(false);
  const [challengeId, setChallengeId] = useState<string>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const logout = () => {
    if (stored?.sessionId) {
      void fetch(`${props.apiBaseUrl}/v1/auth/sessions/${encodeURIComponent(stored.sessionId)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${stored.accessToken}` },
      }).catch(() => undefined);
    }
    sessionStorage.removeItem(storageKey);
    setStored(null);
  };
  useEffect(() => {
    if (!stored) return;
    const expiresAt = stored.accessExpiresAt ? Date.parse(stored.accessExpiresAt) : Number.NaN;
    const delay = Number.isFinite(expiresAt)
      ? Math.max(5_000, expiresAt - Date.now() - 60_000)
      : 10 * 60_000;
    const timer = window.setTimeout(() => {
      void fetch(`${props.apiBaseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Session refresh failed.');
          return (await response.json()) as SessionTokens;
        })
        .then((tokens) => {
          sessionStorage.setItem(storageKey, JSON.stringify(tokens));
          setStored(tokens);
        })
        .catch(() => {
          sessionStorage.removeItem(storageKey);
          setStored(null);
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [props.apiBaseUrl, storageKey, stored]);
  if (stored) {
    const startMfaStepUp = async (): Promise<MfaChallenge> => {
      const response = await fetch(`${props.apiBaseUrl}/v1/auth/mfa/step-up`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stored.accessToken}` },
      });
      const payload = (await response.json()) as MfaChallenge & {
        readonly error?: { readonly message?: string };
      };
      if (!response.ok || payload.status !== 'mfa_required') {
        throw new Error(payload.error?.message ?? 'MFA step-up could not be started.');
      }
      return payload;
    };
    const completeMfaStepUp = async (stepUpChallengeId: string, stepUpCode: string) => {
      const response = await fetch(`${props.apiBaseUrl}/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId: stepUpChallengeId,
          code: stepUpCode,
          deviceLabel: 'Web browser · step-up',
        }),
      });
      const payload = (await response.json()) as SessionTokens & {
        readonly error?: { readonly message?: string };
      };
      if (!response.ok || payload.status !== 'authenticated') {
        throw new Error(payload.error?.message ?? 'MFA verification failed.');
      }
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
      setStored(payload);
    };
    return props.children({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      ...(props.audience === 'tenant' ? { tenantId } : {}),
      apiBaseUrl: props.apiBaseUrl,
      logout,
      startMfaStepUp,
      completeMfaStepUp,
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
      <section className="auth-layout" aria-label="Orvex ISP secure access">
        <aside className="auth-story" aria-label="Product information">
          <div>
            <span className="auth-story__mark" aria-hidden="true">
              O
            </span>
            <p className="auth-story__brand">Orvex ISP · أورفكس</p>
          </div>
          <div className="auth-story__copy">
            <p className="auth-story__kicker">
              {props.audience === 'platform'
                ? 'Vendor operations · عمليات المورّد'
                : 'ISP operations · عمليات مزوّد الإنترنت'}
            </p>
            <h2>
              {props.audience === 'platform'
                ? 'Control the portfolio with confidence.'
                : 'Run the day from one focused workspace.'}
            </h2>
            <p>
              {props.audience === 'platform'
                ? 'Client lifecycle, subscriptions, deployments and financial controls—kept separate from every tenant data plane.'
                : 'Subscribers, billing, collections, installations and service work—permission scoped and audit ready.'}
            </p>
          </div>
          <ul className="auth-story__signals">
            <li>English + العربية</li>
            <li>USD ≠ LBP</li>
            <li>Scoped access</li>
          </ul>
        </aside>

        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <div className="auth-card__heading">
            <span className="auth-card__eyebrow">
              {props.audience === 'platform' ? 'CONTROL CENTER' : 'OPERATIONS'}
            </span>
            <h1>{challengeId ? 'Verify MFA · تأكيد التحقق' : 'Welcome back · أهلاً بعودتك'}</h1>
            <p>
              {challengeId
                ? 'Complete the security check to continue. · أكمل التحقق الأمني للمتابعة.'
                : 'Sign in to your protected workspace. · سجّل الدخول إلى مساحة العمل المحمية.'}
            </p>
          </div>
          <div className="auth-card__fields">
            {challengeId ? (
              <label>
                <span>Verification code · رمز التحقق</span>
                <input
                  autoFocus
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
                  <span>Email · البريد الإلكتروني</span>
                  <input
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    required
                    placeholder="name@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  <span>Password · كلمة المرور</span>
                  <span className="auth-password">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      className="auth-password__toggle"
                      type="button"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? 'Hide · إخفاء' : 'Show · إظهار'}
                    </button>
                  </span>
                </label>
                {props.audience === 'tenant' ? (
                  <label>
                    <span>Workspace ID · معرّف مساحة العمل</span>
                    <input
                      required
                      autoComplete="off"
                      spellCheck={false}
                      pattern="[0-9a-fA-F-]{36}"
                      placeholder="00000000-0000-0000-0000-000000000000"
                      value={tenantId}
                      onChange={(event) => setTenantId(event.target.value)}
                    />
                  </label>
                ) : null}
              </>
            )}
          </div>
          {error ? (
            <p role="alert" className="auth-card__error">
              <span aria-hidden="true">!</span> {error}
            </p>
          ) : null}
          <button className="auth-card__submit" type="submit" disabled={busy}>
            {busy ? 'Checking securely…' : challengeId ? 'Verify · تأكيد' : 'Sign in · دخول'}
          </button>
          <p className="auth-card__security">
            Protected session · No credentials are stored in this browser after sign-out
            <br />
            جلسة محمية · لا تُحفظ بيانات الاعتماد بعد تسجيل الخروج
          </p>
        </form>
      </section>
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
