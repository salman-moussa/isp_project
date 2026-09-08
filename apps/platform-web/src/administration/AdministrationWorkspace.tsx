import { useCallback, useEffect, useState } from 'react';
import {
  IntegrationSettingsPanel,
  type ApiSession,
  type IntegrationSaveInput,
  type IntegrationTestInput,
  type Locale,
} from '@isp/ui';
import {
  ControlApiError,
  configureControlIntegration,
  readControlIntegrations,
  testControlIntegration,
  type ControlIntegrationWorkspace,
} from '../api';

/**
 * Control Center administration: platform provider settings. SMTP here is what delivers
 * sign-in codes, password recovery and staff invitations for every workspace.
 */
export function AdministrationWorkspace({
  session,
  locale,
}: {
  readonly session: ApiSession;
  readonly locale: Locale;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [data, setData] = useState<ControlIntegrationWorkspace>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    readonly tone: 'positive' | 'negative' | 'neutral';
    readonly text: string;
  }>();
  const t = (en: string, ar: string) => (locale === 'ar' ? ar : en);

  const load = useCallback(async () => {
    try {
      const value = await readControlIntegrations(session);
      setData(value);
      setState('ready');
    } catch (error) {
      setState(error instanceof ControlApiError && error.status === 403 ? 'denied' : 'error');
    }
  }, [session]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  const save = async (input: IntegrationSaveInput) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await configureControlIntegration(
        session,
        input.kind,
        {
          config: input.config,
          ...(input.secrets ? { secrets: input.secrets } : {}),
          keepSecrets: input.keepSecrets,
          active: input.active,
          ...(input.expectedVersion !== undefined
            ? { expectedVersion: input.expectedVersion }
            : {}),
          reason: 'reason' in input.evidence ? input.evidence.reason : input.evidence.reasonEn,
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
      const result = await testControlIntegration(
        session,
        input.kind,
        {
          recipient: input.recipient,
          reason: 'reason' in input.evidence ? input.evidence.reason : input.evidence.reasonEn,
        },
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
    <IntegrationSettingsPanel
      locale={locale}
      scope="platform"
      state={state}
      settings={data?.settings ?? []}
      events={data?.recentEvents ?? []}
      deliveries={data?.recentDeliveries ?? []}
      evidenceMode="reason"
      busy={busy}
      message={message}
      onSave={(input) => void save(input)}
      onTest={(input) => void test(input)}
      onRetry={() => {
        setState('loading');
        void load();
      }}
    />
  );
}

function idempotencyKey(): string {
  return `web-integration-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}
