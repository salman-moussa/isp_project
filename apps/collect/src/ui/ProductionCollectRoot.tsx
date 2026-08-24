import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CollectService } from '../core/collect-service';
import type { CollectState } from '../core/model';
import {
  ProductionCollectApi,
  ExpoPayloadHasher,
  ExpoUuidGenerator,
} from '../core/production-api';
import { ExpoAesGcmStateDriver, ExpoSecureDeviceKeyVault } from '../core/production-storage';
import { EncryptedCollectStore } from '../core/storage';
import { CollectSyncEngine } from '../core/sync-engine';
import { CollectApp } from './CollectApp';

declare const process: { readonly env: { readonly EXPO_PUBLIC_API_BASE_URL?: string } };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/u, '') ?? '';
const clock = { now: () => new Date() };

type Phase = 'starting' | 'login' | 'mfa' | 'ready' | 'error';

export function ProductionCollectRoot(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('starting');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('Collector device');
  const [mfaCode, setMfaCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<'online' | 'offline'>('offline');
  const [state, setState] = useState<CollectState>();
  const [lastPaymentId, setLastPaymentId] = useState<string>();
  const api = useRef<ProductionCollectApi | undefined>(undefined);
  const store = useRef<EncryptedCollectStore | undefined>(undefined);
  const service = useRef<CollectService | undefined>(undefined);
  const sync = useRef<CollectSyncEngine | undefined>(undefined);

  useEffect(() => {
    void initialize();
  }, []);

  const initialize = async (): Promise<void> => {
    try {
      if (!apiBaseUrl) throw new Error('EXPO_PUBLIC_API_BASE_URL is required.');
      const openedStore = await EncryptedCollectStore.open({
        mode: 'production',
        keyVault: new ExpoSecureDeviceKeyVault(),
        driver: new ExpoAesGcmStateDriver(),
      });
      const client = new ProductionCollectApi(apiBaseUrl);
      const collectService = new CollectService(
        openedStore,
        clock,
        new ExpoUuidGenerator(),
        new ExpoPayloadHasher(),
      );
      api.current = client;
      store.current = openedStore;
      service.current = collectService;
      sync.current = new CollectSyncEngine(openedStore, client, clock);
      if (!(await client.restore())) {
        setPhase('login');
        return;
      }
      try {
        await installOnlineBootstrap();
      } catch {
        const local = await openedStore.read();
        if (local.device && local.session && local.assignments.length > 0) {
          setState(local);
          setConnection('offline');
          setPhase('ready');
        } else {
          await client.clear();
          setPhase('login');
        }
      }
    } catch (caught) {
      setError(message(caught));
      setPhase('error');
    }
  };

  const installOnlineBootstrap = async (): Promise<void> => {
    const client = requireValue(api.current, 'Collect API');
    const collectService = requireValue(service.current, 'Collect service');
    const openedStore = requireValue(store.current, 'Collect store');
    const bootstrap = await client.bootstrap();
    const serverTime = new Date(bootstrap.serverTime);
    const refreshExpiry = new Date(bootstrap.tokens.refreshExpiresAt);
    const offlineExpiry = new Date(
      Math.min(refreshExpiry.getTime(), serverTime.getTime() + 24 * 60 * 60_000),
    ).toISOString();
    await collectService.installBootstrap({
      device: {
        deviceId: bootstrap.tokens.device.deviceId,
        collectorId: bootstrap.tokens.device.collectorUserId,
        tenantId: bootstrap.tokens.device.tenantId,
        status: 'authorized',
        authorizedAt: bootstrap.serverTime,
        cachedAssignmentsExpireAt: offlineExpiry,
      },
      session: {
        sessionId: bootstrap.tokens.device.sessionId,
        tokenHandle: `secure-store:${bootstrap.tokens.device.deviceId}`,
        deviceId: bootstrap.tokens.device.deviceId,
        collectorId: bootstrap.tokens.device.collectorUserId,
        tenantId: bootstrap.tokens.device.tenantId,
        assignmentContextVersion: bootstrap.cursor,
        authenticatedAt: bootstrap.serverTime,
        mfaVerifiedAt: bootstrap.serverTime,
        expiresAt: offlineExpiry,
      },
      assignments: bootstrap.assignments,
    });
    setState(await openedStore.read());
    setConnection('online');
    setPhase('ready');
  };

  const login = async (): Promise<void> => {
    try {
      setError('');
      const result = await requireValue(api.current, 'Collect API').login({
        email,
        password,
        tenantId,
        deviceLabel,
      });
      if (result.challengeId) {
        setChallengeId(result.challengeId);
        setPhase('mfa');
      } else {
        await installOnlineBootstrap();
      }
    } catch (caught) {
      setError(message(caught));
    }
  };

  const verifyMfa = async (): Promise<void> => {
    try {
      setError('');
      await requireValue(api.current, 'Collect API').verifyMfa({
        challengeId,
        code: mfaCode,
        tenantId,
        deviceLabel,
      });
      await installOnlineBootstrap();
    } catch (caught) {
      setError(message(caught));
    }
  };

  const refreshState = async (): Promise<void> => {
    setState(await requireValue(store.current, 'Collect store').read());
  };

  if (phase === 'starting') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator accessibilityLabel="Loading Orvex ISP Collect" />
        <Text>Loading protected Collect storage…</Text>
      </SafeAreaView>
    );
  }
  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      </SafeAreaView>
    );
  }
  if (phase === 'login' || phase === 'mfa') {
    return (
      <SafeAreaView style={styles.loginPage}>
        <View style={styles.loginCard}>
          <Text style={styles.title}>Orvex ISP Collect</Text>
          {phase === 'login' ? (
            <>
              <TextInput
                accessibilityLabel="Tenant ID"
                autoCapitalize="none"
                value={tenantId}
                onChangeText={setTenantId}
                placeholder="Tenant ID"
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Device label"
                value={deviceLabel}
                onChangeText={setDeviceLabel}
                placeholder="Device label"
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                style={styles.primary}
                onPress={() => void login()}
              >
                <Text style={styles.primaryText}>Sign in securely</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text>Enter the current multi-factor verification code.</Text>
              <TextInput
                accessibilityLabel="Verification code"
                keyboardType="number-pad"
                value={mfaCode}
                onChangeText={setMfaCode}
                placeholder="Verification code"
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                style={styles.primary}
                onPress={() => void verifyMfa()}
              >
                <Text style={styles.primaryText}>Verify device</Text>
              </Pressable>
            </>
          )}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const current = requireValue(state, 'Collect state');
  return (
    <CollectApp
      assignments={current.assignments}
      connection={connection}
      accessState={accessState(current)}
      pendingCount={current.outbox.filter((operation) => operation.status === 'pending').length}
      conflictCount={current.conflicts.length}
      reconciliationTotals={{
        USD: current.payments
          .filter((payment) => payment.currency === 'USD' && payment.syncStatus !== 'rejected')
          .reduce((sum, payment) => sum + payment.amountMinor, 0),
        LBP: current.payments
          .filter((payment) => payment.currency === 'LBP' && payment.syncStatus !== 'rejected')
          .reduce((sum, payment) => sum + payment.amountMinor, 0),
      }}
      referenceMode={false}
      printingAvailable={false}
      reconciliationAvailable
      onQueuePayment={async (input) => {
        const assignment = current.assignments.find(
          (item) => item.assignmentId === input.assignmentId,
        );
        if (!assignment || input.amountMinor !== assignment.outstandingMinor) {
          throw new Error(
            'This assignment currently requires payment of the complete outstanding balance.',
          );
        }
        const payment = await requireValue(service.current, 'Collect service').recordPayment({
          ...input,
          occurredAtDevice: new Date().toISOString(),
        });
        setLastPaymentId(payment.localPaymentId);
        await refreshState();
        if (connection === 'online') {
          await requireValue(sync.current, 'Collect sync').sync();
          await installOnlineBootstrap();
        }
        return { receipt: payment.provisionalReceiptNumber };
      }}
      onPrint={async () => (lastPaymentId ? 'disconnected' : 'failed')}
      onQueueReconciliation={async (input) => {
        const collectService = requireValue(service.current, 'Collect service');
        const reconciliationId = new ExpoUuidGenerator().next();
        await collectService.saveReconciliationDraft({
          reconciliationId,
          businessDate: new Date().toISOString().slice(0, 10),
          declared: [
            { currency: 'USD', method: 'cash', declaredMinor: input.declaredUsdMinor },
            { currency: 'LBP', method: 'cash', declaredMinor: input.declaredLbpMinor },
          ],
          ...(input.note ? { note: input.note } : {}),
        });
        await collectService.submitReconciliation(reconciliationId);
        await refreshState();
        if (connection === 'online') {
          await requireValue(sync.current, 'Collect sync').sync();
          await installOnlineBootstrap();
        }
      }}
      onRetrySync={async () => {
        await requireValue(sync.current, 'Collect sync').sync();
        await installOnlineBootstrap();
      }}
    />
  );
}

function accessState(state: CollectState): 'ready' | 'revoked' | 'expired' {
  if (state.device?.status === 'revoked' || state.lockedReason === 'revoked') return 'revoked';
  if (state.lockedReason || !state.session || Date.parse(state.session.expiresAt) <= Date.now())
    return 'expired';
  return 'ready';
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is not initialized.`);
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed safely.';
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  loginPage: { flex: 1, backgroundColor: '#07111f', justifyContent: 'center', padding: 20 },
  loginCard: { backgroundColor: '#f5f8fb', borderRadius: 18, padding: 20, gap: 12 },
  title: { color: '#10243b', fontSize: 24, fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: '#9aabba',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#ffffff',
  },
  primary: { backgroundColor: '#087b70', padding: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '800' },
  error: { color: '#991b1b' },
});
