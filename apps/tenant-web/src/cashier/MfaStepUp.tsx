import { useEffect, useRef, useState } from 'react';
import type { ApiSession, Locale } from '@isp/ui';

/**
 * Inline identity verification for commands the API guards with recent MFA (voids, approvals).
 * It only refreshes the session's step-up; the guarded command is submitted by the caller.
 */
export function MfaStepUp({
  locale,
  session,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'verified' | 'error'>('idle');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!session.startMfaStepUp || !session.completeMfaStepUp) return null;
  async function start() {
    setStatus('busy');
    try {
      const result = await session.startMfaStepUp!();
      if (alive.current) {
        setChallenge(result.challengeId);
        setStatus('idle');
      }
    } catch {
      if (alive.current) setStatus('error');
    }
  }
  async function complete() {
    setStatus('busy');
    try {
      await session.completeMfaStepUp!(challenge, code.trim());
      if (alive.current) {
        setChallenge('');
        setCode('');
        setStatus('verified');
      }
    } catch {
      if (alive.current) setStatus('error');
    }
  }
  return (
    <div
      className="mfa-step-up"
      role="group"
      aria-label={t('Identity verification', 'التحقق من الهوية')}
    >
      {status === 'verified' ? (
        <span className="mfa-step-up__ok">
          {t('Identity verified for this session.', 'تم التحقق من الهوية لهذه الجلسة.')}
        </span>
      ) : challenge ? (
        <>
          <label>
            {t('Verification code', 'رمز التحقق')}
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={status === 'busy' || !code.trim()}
            onClick={() => void complete()}
          >
            {t('Confirm code', 'تأكيد الرمز')}
          </button>
        </>
      ) : (
        <button type="button" disabled={status === 'busy'} onClick={() => void start()}>
          {t('Verify identity', 'التحقق من الهوية')}
        </button>
      )}
      {status === 'error' && (
        <span className="mfa-step-up__error" role="alert">
          {t('Verification failed. Try again.', 'فشل التحقق. حاول مجدداً.')}
        </span>
      )}
    </div>
  );
}
