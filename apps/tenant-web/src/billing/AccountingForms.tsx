import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ApiSession, Locale } from '@isp/ui';
import {
  journalEntryInputSchema,
  periodCloseRequestSchema,
  type ChartOfAccountRecord,
  type JournalEntryRecord,
} from '@isp/contracts';
import { submitTenantOperation } from '../api';
import { parseAccountAmount } from './account-money';

type Line = {
  id: number;
  accountId: string;
  currency: 'USD' | 'LBP';
  side: 'debit' | 'credit';
  amount: string;
};
export function AccountingForms({
  locale,
  session,
  mode,
  accounts,
  journals,
  disabled,
  onPosted,
}: {
  readonly locale: Locale;
  readonly session: ApiSession;
  readonly mode: 'journal' | 'periods';
  readonly accounts: readonly ChartOfAccountRecord[];
  readonly journals: readonly JournalEntryRecord[];
  readonly disabled: boolean;
  readonly onPosted: () => void;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [lines, setLines] = useState<Line[]>([
    { id: 1, accountId: '', currency: 'USD', side: 'debit', amount: '' },
    { id: 2, accountId: '', currency: 'USD', side: 'credit', amount: '' },
  ]);
  const nextLine = useRef(3),
    locked = useRef(false),
    alive = useRef(true);
  const retry = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [challenge, setChallenge] = useState(''),
    [code, setCode] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const changeLine = (id: number, change: Partial<Line>) =>
    setLines((old) => old.map((line) => (line.id === id ? { ...line, ...change } : line)));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || disabled) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const value = (key: string) => {
      const field = data.get(key);
      return typeof field === 'string' ? field.trim() : '';
    };
    let payload: Record<string, unknown>;
    try {
      payload =
        mode === 'journal'
          ? {
              command: journalEntryInputSchema.parse({
                entryNumber: value('number'),
                entryDate: value('date'),
                descriptionEn: value('reasonEn'),
                descriptionAr: value('reasonAr'),
                sourceType: 'manual',
                ...(value('classifies') ? { classifiesJournalId: value('classifies') } : {}),
                lines: lines.map((line) => {
                  const amount = parseAccountAmount(line.amount, line.currency);
                  return {
                    accountId: line.accountId,
                    currency: line.currency,
                    debitMinor: line.side === 'debit' ? amount : 0,
                    creditMinor: line.side === 'credit' ? amount : 0,
                  };
                }),
              }),
            }
          : {
              request: periodCloseRequestSchema.parse({
                periodName: value('number'),
                startDate: value('start'),
                endDate: value('end'),
                closeType: value('closeType'),
                notesEn: value('reasonEn'),
                notesAr: value('reasonAr'),
              }),
            };
    } catch {
      setError('validation');
      return;
    }
    const path = mode === 'journal' ? 'accounting/journals' : 'accounting/periods/close';
    const fingerprint = JSON.stringify({ path, payload });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await submitTenantOperation(session, path, payload, retry.current.key);
      if (!alive.current) return;
      retry.current = undefined;
      setNotice(
        t(
          'Posting confirmed and recorded in the audit trail.',
          'تم تأكيد الترحيل وتسجيله في سجل التدقيق.',
        ),
      );
      form.reset();
      setLines([
        { id: 1, accountId: '', currency: 'USD', side: 'debit', amount: '' },
        { id: 2, accountId: '', currency: 'USD', side: 'credit', amount: '' },
      ]);
      nextLine.current = 3;
      onPosted();
    } catch {
      if (alive.current) setError('post');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function mfa(complete = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      if (complete) {
        await session.completeMfaStepUp!(challenge, code.trim());
        if (alive.current) {
          setChallenge('');
          setCode('');
          setNotice(
            t(
              'Identity verified. You can submit the form.',
              'تم التحقق من الهوية. يمكنك إرسال النموذج.',
            ),
          );
        }
      } else {
        const result = await session.startMfaStepUp!();
        if (alive.current) setChallenge(result.challengeId);
      }
    } catch {
      if (alive.current) setError('mfa');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="billing-panel accounting-editor" aria-busy={busy}>
      <h2>
        {mode === 'journal'
          ? t('Post a journal or classification', 'ترحيل قيد أو تصنيف')
          : t('Close an accounting period', 'إغلاق فترة محاسبية')}
      </h2>
      <p>
        {t(
          'Recent MFA and accounting permission are required. Posted records cannot be edited. Classification must fully clear the selected source.',
          'يلزم تحقق متعدد العوامل حديث وصلاحية المحاسبة. لا يمكن تعديل القيود المرحلة. يجب أن يصفّي التصنيف حسابات المصدر المحدد بالكامل.',
        )}
      </p>
      {session.startMfaStepUp && (
        <button type="button" disabled={busy} onClick={() => void mfa()}>
          {t('Verify identity', 'التحقق من الهوية')}
        </button>
      )}
      {challenge && session.completeMfaStepUp && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void mfa(true);
          }}
        >
          <label>
            {t('Verification code', 'رمز التحقق')}
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {t('Confirm identity', 'تأكيد الهوية')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert">
          {error === 'validation'
            ? t(
                'Check valid dates, bilingual reasons and balanced amounts. USD accepts cents; LBP uses whole pounds.',
                'تحقق من التواريخ والأسباب باللغتين وتوازن المبالغ. الدولار يقبل السنتات والليرة أعداداً صحيحة.',
              )
            : error === 'mfa'
              ? t(
                  'Identity verification failed. Please retry.',
                  'تعذر التحقق من الهوية. أعد المحاولة.',
                )
              : t(
                  'Posting was not confirmed. Check permission/MFA, closed periods and reconciliation requirements. Retry unchanged values to recover a lost response safely.',
                  'لم يتأكد الترحيل. تحقق من الصلاحيات والتحقق الحديث والفترات المغلقة ومتطلبات التسوية. أعد إرسال القيم نفسها لاستعادة الرد بأمان.',
                )}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy || disabled}>
          <legend>
            {mode === 'journal'
              ? t('Journal details', 'تفاصيل القيد')
              : t('Period details', 'تفاصيل الفترة')}
          </legend>
          <label>
            {t('Reference', 'المرجع')}
            <input name="number" required maxLength={100} />
          </label>
          {mode === 'journal' ? (
            <>
              <label>
                {t('Entry date', 'تاريخ القيد')}
                <input name="date" type="date" required />
              </label>
              <label>
                {t(
                  'Classify existing clearing entry (optional)',
                  'تصنيف قيد معلّق موجود (اختياري)',
                )}
                <select name="classifies" defaultValue="">
                  <option value="">{t('Ordinary manual journal', 'قيد يدوي عادي')}</option>
                  {journals
                    .filter((j) => j.classificationRequired)
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.entryNumber} — {j.entryDate}
                      </option>
                    ))}
                </select>
              </label>
              {lines.map((line, index) => (
                <fieldset key={line.id}>
                  <legend>
                    {t('Line', 'السطر')} {index + 1}
                  </legend>
                  <label>
                    {t('Account', 'الحساب')}
                    <select
                      required
                      value={line.accountId}
                      onChange={(e) => changeLine(line.id, { accountId: e.target.value })}
                    >
                      <option value="">{t('Choose account', 'اختر الحساب')}</option>
                      {accounts
                        .filter(
                          (a) => a.active && (a.currency === 'ANY' || a.currency === line.currency),
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountCode} — {locale === 'ar' ? a.accountNameAr : a.accountNameEn}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t('Currency', 'العملة')}
                    <select
                      value={line.currency}
                      onChange={(e) =>
                        changeLine(line.id, {
                          currency: e.target.value as 'USD' | 'LBP',
                          accountId: '',
                        })
                      }
                    >
                      <option>USD</option>
                      <option>LBP</option>
                    </select>
                  </label>
                  <label>
                    {t('Side', 'الجهة')}
                    <select
                      value={line.side}
                      onChange={(e) =>
                        changeLine(line.id, { side: e.target.value as 'debit' | 'credit' })
                      }
                    >
                      <option value="debit">{t('Debit', 'مدين')}</option>
                      <option value="credit">{t('Credit', 'دائن')}</option>
                    </select>
                  </label>
                  <label>
                    {t('Amount', 'المبلغ')}
                    <input
                      required
                      inputMode="decimal"
                      value={line.amount}
                      onChange={(e) => changeLine(line.id, { amount: e.target.value })}
                    />
                  </label>
                  {lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setLines((old) => old.filter((l) => l.id !== line.id))}
                    >
                      {t('Remove line', 'حذف السطر')}
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                disabled={lines.length >= 200}
                onClick={() =>
                  setLines((old) => [
                    ...old,
                    {
                      id: nextLine.current++,
                      accountId: '',
                      currency: 'USD',
                      side: 'debit',
                      amount: '',
                    },
                  ])
                }
              >
                {t('Add line', 'إضافة سطر')}
              </button>
            </>
          ) : (
            <>
              <p>
                {t(
                  'Close is blocked while sources, legacy entries or classifications need reconciliation. This does not send a bank transfer.',
                  'يُمنع الإغلاق ما دامت المصادر أو القيود القديمة أو التصنيفات بحاجة إلى تسوية. لا يُرسل أي تحويل مصرفي.',
                )}
              </p>
              <label>
                {t('Start date', 'تاريخ البداية')}
                <input name="start" type="date" required />
              </label>
              <label>
                {t('End date', 'تاريخ النهاية')}
                <input name="end" type="date" required />
              </label>
              <label>
                {t('Close type', 'نوع الإغلاق')}
                <select name="closeType">
                  <option value="soft">{t('Soft close', 'إغلاق أولي')}</option>
                  <option value="hard">{t('Hard close', 'إغلاق نهائي')}</option>
                </select>
              </label>
              <label>
                <input name="confirm" type="checkbox" required />
                {t(
                  'I reviewed this period. Closing blocks further postings to its dates.',
                  'راجعت هذه الفترة. الإغلاق يمنع ترحيل قيود جديدة ضمن تواريخها.',
                )}
              </label>
            </>
          )}
          <label>
            {t('Reason in English', 'السبب بالإنجليزية')}
            <textarea
              name="reasonEn"
              minLength={8}
              maxLength={mode === 'journal' ? 500 : 1000}
              required
              lang="en"
              dir="ltr"
            />
          </label>
          <label>
            {t('Reason in Arabic', 'السبب بالعربية')}
            <textarea
              name="reasonAr"
              minLength={8}
              maxLength={mode === 'journal' ? 500 : 1000}
              required
              lang="ar"
              dir="rtl"
            />
          </label>
          <button type="submit">
            {busy
              ? t('Saving…', 'جارٍ الحفظ…')
              : mode === 'journal'
                ? t('Post journal', 'ترحيل القيد')
                : t('Close period', 'إغلاق الفترة')}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
