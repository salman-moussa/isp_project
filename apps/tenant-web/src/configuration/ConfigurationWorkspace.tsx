import { useCallback, useEffect, useState } from 'react';
import type { TenantIntegrationWorkspace } from '@isp/contracts';
import {
  IntegrationSettingsPanel,
  type ApiSession,
  type IntegrationSaveInput,
  type IntegrationTestInput,
  type Locale,
} from '@isp/ui';
import { TenantApiError, readTenantIntegrations, submitTenantOperation } from '../api';
import { OperationsWorkspace, operationPath } from '../operations/OperationsWorkspace';
import './configuration.css';

type Tab = 'integrations' | 'defaults';

/**
 * Tenant configuration: provider integrations (SMTP, SMS, WhatsApp) for customer messaging plus
 * the versioned non-secret operations defaults. Provider credentials never round-trip to the UI.
 */
export function ConfigurationWorkspace({
  session,
  locale,
}: {
  readonly session: ApiSession;
  readonly locale: Locale;
}) {
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const [tab, setTab] = useState<Tab>('integrations');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [data, setData] = useState<TenantIntegrationWorkspace>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    readonly tone: 'positive' | 'negative' | 'neutral';
    readonly text: string;
  }>();

  const load = useCallback(async () => {
    try {
      const value = await readTenantIntegrations(session);
      setData(value);
      setState('ready');
    } catch (error) {
      setState(error instanceof TenantApiError && error.status === 403 ? 'denied' : 'error');
    }
  }, [session]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  const evidenceOf = (input: IntegrationSaveInput | IntegrationTestInput) =>
    'reason' in input.evidence
      ? {
          reasonEn: input.evidence.reason,
          reasonAr: input.evidence.reason,
          evidence: input.evidence.reason,
        }
      : input.evidence;

  const save = async (input: IntegrationSaveInput) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await submitTenantOperation(
        session,
        'integrations/configure',
        {
          command: {
            kind: input.kind,
            config: input.config,
            ...(input.secrets ? { secrets: input.secrets } : {}),
            keepSecrets: input.keepSecrets,
            active: input.active,
            ...(input.expectedVersion !== undefined
              ? { expectedVersion: input.expectedVersion }
              : {}),
            ...evidenceOf(input),
          },
        },
        idempotencyKey(),
      );
      setMessage({
        tone: 'positive',
        text: t(
          `Settings saved as version ${String(result.version)}.`,
          `تم حفظ الإعدادات كنسخة ${String(result.version)}.`,
        ),
      });
      await load();
    } catch (error) {
      setMessage({
        tone: 'negative',
        text: error instanceof Error ? error.message : t('Saving failed.', 'فشل الحفظ.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const test = async (input: IntegrationTestInput) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await submitTenantOperation(
        session,
        'integrations/test',
        { command: { kind: input.kind, recipient: input.recipient, ...evidenceOf(input) } },
        idempotencyKey(),
      );
      const passed = result.status === 'passed';
      setMessage({
        tone: passed ? 'positive' : 'negative',
        text: `${passed ? t('Test passed', 'نجح الاختبار') : t('Test failed', 'فشل الاختبار')}${
          typeof result.lastTestMessage === 'string' ? ` · ${result.lastTestMessage}` : ''
        }`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: 'negative',
        text: error instanceof Error ? error.message : t('The test failed.', 'فشل الاختبار.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="configuration-shell" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <nav className="configuration-tabs" aria-label={t('Configuration areas', 'أقسام الإعدادات')}>
        <button
          type="button"
          aria-current={tab === 'integrations' ? 'page' : undefined}
          onClick={() => setTab('integrations')}
        >
          {t('Integrations', 'التكاملات')}
        </button>
        <button
          type="button"
          aria-current={tab === 'defaults' ? 'page' : undefined}
          onClick={() => setTab('defaults')}
        >
          {t('Operations defaults', 'الإعدادات التشغيلية')}
        </button>
      </nav>
      {tab === 'integrations' ? (
        <IntegrationSettingsPanel
          locale={locale}
          scope="tenant"
          state={state}
          settings={data?.settings ?? []}
          events={data?.events ?? []}
          evidenceMode="bilingual"
          busy={busy}
          message={message}
          onSave={(input) => void save(input)}
          onTest={(input) => void test(input)}
          onRetry={() => {
            setState('loading');
            void load();
          }}
        />
      ) : (
        <OperationsWorkspace
          locale={locale}
          initialTask="configuration"
          state="empty"
          onSubmit={(task, payload, key) =>
            submitTenantOperation(session, operationPath(task), payload, key)
          }
        />
      )}
    </div>
  );
}

function idempotencyKey(): string {
  return `web-integration-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}
