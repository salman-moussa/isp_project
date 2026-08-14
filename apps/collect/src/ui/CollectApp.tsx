import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Assignment, Currency, PaymentMethod } from '../core/model.js';
import { t, type Locale } from './copy.js';

export interface CollectAppProps {
  readonly assignments: readonly Assignment[];
  readonly connection: 'online' | 'offline';
  readonly accessState: 'ready' | 'loading' | 'revoked' | 'expired';
  readonly pendingCount: number;
  readonly conflictCount: number;
  readonly referenceMode: boolean;
  readonly printingAvailable?: boolean;
  readonly reconciliationAvailable?: boolean;
  readonly onQueuePayment: (input: {
    assignmentId: string;
    amountMinor: number;
    currency: Currency;
    method: PaymentMethod;
    allocationInvoiceId: string;
  }) => Promise<{ receipt: string }>;
  readonly onPrint: () => Promise<'printed' | 'failed' | 'disconnected'>;
  readonly onQueueReconciliation: () => Promise<void>;
  readonly onRetrySync: () => Promise<void>;
}

const methods: readonly PaymentMethod[] = ['cash', 'omt', 'whish', 'bank_transfer'];

export function CollectApp(props: CollectAppProps): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>('en');
  const [selected, setSelected] = useState(props.assignments[0]?.assignmentId ?? '');
  const assignment = props.assignments.find((item) => item.assignmentId === selected);
  const [currency, setCurrency] = useState<Currency>(assignment?.currency ?? 'USD');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const text = t(locale);
  const rtl = locale === 'ar';
  const direction = { direction: rtl ? 'rtl' : 'ltr' } as const;

  if (props.accessState === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator accessibilityLabel={text('loading')} />
        <Text>{text('loading')}</Text>
      </SafeAreaView>
    );
  }

  const locked = props.accessState === 'revoked' || props.accessState === 'expired';
  const queuePayment = async (): Promise<void> => {
    if (assignment === undefined || locked) return;
    const amountMinor = Number(amount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      setNotice(text('amount'));
      return;
    }
    try {
      const result = await props.onQueuePayment({
        assignmentId: assignment.assignmentId,
        amountMinor,
        currency,
        method,
        allocationInvoiceId: `invoice:${assignment.serviceReference}`,
      });
      setReceipt(result.receipt);
      setNotice(text('queued'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text('saveFailure'));
    }
  };

  const print = async (): Promise<void> => {
    const outcome = await props.onPrint();
    setNotice(outcome === 'printed' ? text('print') : text('printerFailure'));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.page}>
        <View style={[styles.header, direction]}>
          <View>
            <Text style={styles.brand}>{text('appName')}</Text>
            <Text style={styles.status}>
              {props.connection === 'online' ? text('online') : text('offline')} · {text('queue')}{' '}
              {props.pendingCount} · {props.conflictCount} {text('conflicts')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={locale === 'en' ? 'العربية' : 'English'}
            style={styles.locale}
            onPress={() => setLocale(locale === 'en' ? 'ar' : 'en')}
          >
            <Text style={styles.localeText}>{locale === 'en' ? 'العربية' : 'English'}</Text>
          </Pressable>
        </View>
        {props.referenceMode ? (
          <Text accessibilityRole="alert" style={styles.demo}>
            {text('reference')}
          </Text>
        ) : null}
        {locked ? (
          <Text accessibilityRole="alert" style={styles.danger}>
            {props.accessState === 'revoked' ? text('revoked') : text('expired')}
          </Text>
        ) : null}
        <Text style={[styles.security, direction]}>{text('security')}</Text>

        <View style={styles.card}>
          <Text style={[styles.heading, direction]}>{text('assignedRoute')}</Text>
          {props.assignments.length === 0 ? (
            <Text style={direction}>{text('empty')}</Text>
          ) : (
            props.assignments.map((item) => (
              <Pressable
                key={item.assignmentId}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === item.assignmentId }}
                style={[styles.assignment, selected === item.assignmentId && styles.selected]}
                onPress={() => {
                  setSelected(item.assignmentId);
                  setCurrency(item.currency);
                }}
              >
                <Text style={[styles.subscriber, direction]}>{item.subscriberName}</Text>
                <Text style={direction}>
                  {rtl ? item.routeNameAr : item.routeNameEn} · {rtl ? item.areaAr : item.areaEn}
                </Text>
                <Text style={[styles.money, direction]}>
                  {text('outstanding')}: {item.outstandingMinor} {item.currency}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={[styles.heading, direction]}>{text('collect')}</Text>
          <Text style={direction}>{text('currency')}</Text>
          <View style={[styles.row, direction]}>
            {(['USD', 'LBP'] as const).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="radio"
                accessibilityState={{ checked: currency === item }}
                style={[styles.choice, currency === item && styles.choiceActive]}
                onPress={() => setCurrency(item)}
              >
                <Text>{item}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel={text('amount')}
            inputMode="numeric"
            value={amount}
            onChangeText={setAmount}
            placeholder={text('amount')}
            style={[styles.input, direction]}
          />
          <Text style={direction}>{text('method')}</Text>
          <View style={[styles.wrap, direction]}>
            {methods.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="radio"
                accessibilityState={{ checked: method === item }}
                style={[styles.choice, method === item && styles.choiceActive]}
                onPress={() => setMethod(item)}
              >
                <Text>{item}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: locked || assignment === undefined }}
            disabled={locked || assignment === undefined}
            style={[styles.primary, (locked || assignment === undefined) && styles.disabled]}
            onPress={() => void queuePayment()}
          >
            <Text style={styles.primaryText}>{text('save')}</Text>
          </Pressable>
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={[styles.notice, direction]}>
              {notice}
            </Text>
          ) : null}
          {receipt ? (
            <View style={styles.receipt}>
              <Text style={direction}>
                {text('provisional')}: {receipt}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: props.printingAvailable === false }}
                disabled={props.printingAvailable === false}
                style={[styles.secondary, props.printingAvailable === false && styles.disabled]}
                onPress={() => void print()}
              >
                <Text>{text('print')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={[styles.heading, direction]}>{text('reconciliation')}</Text>
          <View style={[styles.reconHeader, direction]}>
            <Text>{text('expected')}: USD 0 / LBP 0</Text>
            <Text>{text('declared')}: USD 0 / LBP 0</Text>
          </View>
          <Text style={[styles.warning, direction]}>{text('manager')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: props.reconciliationAvailable === false }}
            disabled={props.reconciliationAvailable === false}
            style={[styles.secondary, props.reconciliationAvailable === false && styles.disabled]}
            onPress={() => void props.onQueueReconciliation()}
          >
            <Text>{text('submit')}</Text>
          </Pressable>
          {props.reconciliationAvailable === false ? (
            <Text style={[styles.warning, direction]}>{text('featureUnavailable')}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.retry}
          onPress={() => void props.onRetrySync()}
        >
          <Text>{text('retry')}</Text>
        </Pressable>
        <Text style={[styles.help, direction]}>{text('help')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#07111f' },
  page: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: {
    backgroundColor: '#10243b',
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { color: '#ffffff', fontSize: 23, fontWeight: '800' },
  status: { color: '#bad2e8', marginTop: 5 },
  locale: { borderColor: '#65d6c1', borderWidth: 1, padding: 10, borderRadius: 12 },
  localeText: { color: '#ffffff', fontWeight: '700' },
  demo: {
    backgroundColor: '#f9d66f',
    color: '#241b00',
    padding: 10,
    borderRadius: 10,
    fontWeight: '700',
  },
  danger: { backgroundColor: '#7f1d1d', color: '#ffffff', padding: 14, borderRadius: 12 },
  security: { color: '#c4d6e7', paddingHorizontal: 4 },
  card: { backgroundColor: '#f5f8fb', padding: 16, borderRadius: 18, gap: 10 },
  heading: { color: '#10243b', fontSize: 19, fontWeight: '800' },
  assignment: { padding: 12, borderWidth: 1, borderColor: '#cad5df', borderRadius: 12, gap: 3 },
  selected: { borderColor: '#087b70', backgroundColor: '#e0f4f0' },
  subscriber: { fontSize: 17, fontWeight: '700' },
  money: { color: '#334b61', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderWidth: 1,
    borderColor: '#9aabba',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
  },
  choiceActive: { borderColor: '#087b70', backgroundColor: '#bde9e1' },
  input: {
    borderWidth: 1,
    borderColor: '#9aabba',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#ffffff',
  },
  primary: { backgroundColor: '#087b70', padding: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '800' },
  disabled: { opacity: 0.45 },
  secondary: {
    borderWidth: 1,
    borderColor: '#087b70',
    padding: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  notice: { color: '#07584f', fontWeight: '700' },
  receipt: { borderTopWidth: 1, borderColor: '#cad5df', paddingTop: 10, gap: 8 },
  reconHeader: { gap: 4 },
  warning: { color: '#774f00' },
  retry: { backgroundColor: '#dbe8f2', padding: 13, borderRadius: 12, alignItems: 'center' },
  help: { color: '#bad2e8', textAlign: 'center', padding: 8 },
});
