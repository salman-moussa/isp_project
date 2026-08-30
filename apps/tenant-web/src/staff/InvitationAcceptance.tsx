import { useEffect, useState, type FormEvent } from 'react';
import { Button, LocaleSwitcher, StatusBadge, type Locale } from '@isp/ui';
import { acceptTenantStaffInvitation } from '../api';

export function InvitationAcceptance({
  apiBaseUrl,
  token,
}: {
  readonly apiBaseUrl: string;
  readonly token: string;
}) {
  const [locale, setLocale] = useState<Locale>('en');
  const [state, setState] = useState<'ready' | 'busy' | 'success' | 'error'>('ready');
  const [message, setMessage] = useState<string>();
  const [tenantId, setTenantId] = useState<string>();
  const isEnglish = locale === 'en';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isEnglish ? 'ltr' : 'rtl';
  }, [isEnglish, locale]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = formText(data, 'password');
    const confirmation = formText(data, 'confirmation');
    if (password !== confirmation) {
      setState('error');
      setMessage(
        isEnglish ? 'The password confirmation does not match.' : 'تأكيد كلمة المرور غير مطابق.',
      );
      return;
    }
    setState('busy');
    setMessage(undefined);
    void acceptTenantStaffInvitation(apiBaseUrl, token, password)
      .then((result) => {
        setTenantId(result.tenantId);
        setState('success');
        window.history.replaceState(null, '', '#/staff-invitation');
      })
      .catch((error) => {
        setState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <main className="invitation-acceptance">
      <section className="invitation-acceptance__card" aria-labelledby="invitation-title">
        <header>
          <div>
            <span className="invitation-acceptance__mark" aria-hidden="true">
              O
            </span>
            <div>
              <strong>ORVEX</strong>
              <small>{isEnglish ? 'ISP Operations' : 'عمليات مزوّد الإنترنت'}</small>
            </div>
          </div>
          <LocaleSwitcher
            locale={locale}
            onChange={setLocale}
            englishLabel="EN"
            arabicLabel="ع"
            groupLabel={isEnglish ? 'Interface language' : 'لغة الواجهة'}
          />
        </header>
        {state === 'success' ? (
          <div className="invitation-acceptance__result" role="status">
            <StatusBadge tone="positive">
              {isEnglish ? 'Invitation accepted' : 'تم قبول الدعوة'}
            </StatusBadge>
            <h1 id="invitation-title">
              {isEnglish ? 'Your employee account is ready.' : 'حساب الموظف جاهز.'}
            </h1>
            <p>
              {isEnglish
                ? 'Use the tenant identifier below when signing in. MFA will be required when your role policy demands it.'
                : 'استخدم معرّف المستأجر أدناه عند تسجيل الدخول. سيُطلب التحقق عندما تفرضه سياسة دورك.'}
            </p>
            <code dir="ltr">{tenantId}</code>
            <Button variant="primary" onClick={() => window.location.assign('/')}>
              {isEnglish ? 'Continue to sign in' : 'المتابعة إلى تسجيل الدخول'}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <span className="invitation-acceptance__eyebrow">
              {isEnglish ? 'Secure staff onboarding' : 'إعداد الموظف الآمن'}
            </span>
            <h1 id="invitation-title">
              {isEnglish ? 'Create your password' : 'إنشاء كلمة المرور'}
            </h1>
            <p>
              {isEnglish
                ? 'This one-time invitation creates or connects your employee identity. It never creates subscriber access.'
                : 'تنشئ هذه الدعوة لمرة واحدة هوية الموظف أو تربطها. ولا تنشئ وصولاً للمشتركين.'}
            </p>
            <label>
              <span>{isEnglish ? 'New password' : 'كلمة المرور الجديدة'}</span>
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>{isEnglish ? 'Confirm password' : 'تأكيد كلمة المرور'}</span>
              <input
                name="confirmation"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
            {message ? (
              <p className="invitation-acceptance__error" role="alert">
                {message}
              </p>
            ) : null}
            <Button
              variant="primary"
              type="submit"
              disabled={state === 'busy' || token.length < 32}
            >
              {state === 'busy'
                ? isEnglish
                  ? 'Accepting…'
                  : 'جارٍ القبول…'
                : isEnglish
                  ? 'Accept invitation'
                  : 'قبول الدعوة'}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}

function formText(data: FormData, field: string): string {
  const value = data.get(field);
  return typeof value === 'string' ? value : '';
}
