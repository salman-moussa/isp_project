import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { CollectSyncEndpoint, PayloadHasher, SyncResponse } from './adapters';
import type { Assignment, OutboxOperation } from './model';

const TOKENS_KEY = 'orvex.collect.tokens.v1';
const DEVICE_KEY = 'orvex.collect.device-thumbprint.v1';

interface CollectTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
  readonly device: {
    readonly deviceId: string;
    readonly tenantId: string;
    readonly collectorUserId: string;
    readonly sessionId: string;
  };
}

interface BootstrapResponse {
  readonly cursor: number;
  readonly serverTime: string;
  readonly assignments: readonly {
    assignmentId: string;
    subscriberId: string;
    subscriberNumber: string;
    subscriberDisplayName: string;
    addressLine: string;
    routeId: string;
    routeReference: string;
    invoiceId: string;
    outstandingAmountMinor: number;
    currency: 'USD' | 'LBP';
  }[];
}

export class ExpoPayloadHasher implements PayloadHasher {
  public async hash(payload: Readonly<Record<string, unknown>>): Promise<string> {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, stableJson(payload), {
      encoding: Crypto.CryptoEncoding.HEX,
    });
  }
}

export class ExpoUuidGenerator {
  public next(): string {
    return Crypto.randomUUID();
  }
}

export class ProductionCollectApi implements CollectSyncEndpoint {
  private tokens: CollectTokens | undefined;

  public constructor(private readonly baseUrl: string) {
    if (
      !/^https:\/\//u.test(baseUrl) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(baseUrl)
    ) {
      throw new Error('Collect API must use HTTPS outside local development.');
    }
  }

  public async restore(): Promise<boolean> {
    const stored = await SecureStore.getItemAsync(TOKENS_KEY);
    if (!stored) return false;
    try {
      const parsed = JSON.parse(stored) as CollectTokens;
      if (
        !parsed.accessToken ||
        !parsed.refreshToken ||
        !parsed.refreshExpiresAt ||
        !parsed.device?.deviceId ||
        !parsed.device.tenantId ||
        !parsed.device.collectorUserId ||
        !parsed.device.sessionId
      ) {
        throw new Error('Incomplete Collect credentials.');
      }
      this.tokens = parsed;
      return true;
    } catch {
      await SecureStore.deleteItemAsync(TOKENS_KEY);
      return false;
    }
  }

  public async login(input: {
    readonly email: string;
    readonly password: string;
    readonly tenantId: string;
    readonly deviceLabel: string;
  }): Promise<{ readonly challengeId?: string }> {
    const result = await this.request<
      | { status: 'mfa_required'; challengeId: string }
      | { status: 'authenticated'; accessToken: string }
    >('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ ...input, audience: 'tenant' }),
    });
    if (result.status === 'mfa_required') return { challengeId: result.challengeId };
    await this.authorizeDevice(result.accessToken, input.tenantId, input.deviceLabel);
    return {};
  }

  public async verifyMfa(input: {
    readonly challengeId: string;
    readonly code: string;
    readonly tenantId: string;
    readonly deviceLabel: string;
  }): Promise<void> {
    const result = await this.request<{ status: 'authenticated'; accessToken: string }>(
      '/v1/auth/mfa/verify',
      { method: 'POST', body: JSON.stringify(input) },
    );
    await this.authorizeDevice(result.accessToken, input.tenantId, input.deviceLabel);
  }

  private async authorizeDevice(jwt: string, tenantId: string, deviceLabel: string) {
    let thumbprint = await SecureStore.getItemAsync(DEVICE_KEY);
    if (!thumbprint) {
      thumbprint = `sha256:${await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        toHex(Crypto.getRandomBytes(32)),
      )}`;
      await SecureStore.setItemAsync(DEVICE_KEY, thumbprint);
    }
    const tokens = await this.request<CollectTokens>(
      `/v1/tenants/${encodeURIComponent(tenantId)}/collect/devices/authorize`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ deviceLabel, devicePublicKeyThumbprint: thumbprint }),
      },
    );
    await this.store(tokens);
  }

  public async bootstrap(): Promise<{
    readonly tokens: CollectTokens;
    readonly cursor: number;
    readonly serverTime: string;
    readonly assignments: readonly Assignment[];
  }> {
    let response = await this.authorized('/v1/collect/bootstrap');
    if (response.status === 401) {
      await this.refresh();
      response = await this.authorized('/v1/collect/bootstrap');
    }
    const bootstrap = await parseResponse<BootstrapResponse>(response);
    const tokens = this.requireTokens();
    return {
      tokens,
      cursor: bootstrap.cursor,
      serverTime: bootstrap.serverTime,
      assignments: bootstrap.assignments.map((assignment) => ({
        assignmentId: assignment.assignmentId,
        assignmentVersion: bootstrap.cursor,
        routeId: assignment.routeId,
        routeNameEn: assignment.routeReference,
        routeNameAr: assignment.routeReference,
        subscriberId: assignment.subscriberId,
        subscriberName: assignment.subscriberDisplayName,
        serviceReference: assignment.invoiceId,
        areaEn: assignment.addressLine,
        areaAr: assignment.addressLine,
        outstandingMinor: assignment.outstandingAmountMinor,
        currency: assignment.currency,
      })),
    };
  }

  public async push(request: {
    readonly deviceId: string;
    readonly sessionId: string;
    readonly operations: readonly OutboxOperation[];
  }): Promise<SyncResponse> {
    if (request.operations.some((operation) => operation.type !== 'payment.create')) {
      throw new Error('This Collect build cannot yet serialize a non-payment operation safely.');
    }
    const operations = request.operations.map(serializeOperation);
    let response = await this.authorized('/v1/collect/sync', {
      method: 'POST',
      body: JSON.stringify({ operations }),
    });
    if (response.status === 401) {
      await this.refresh();
      response = await this.authorized('/v1/collect/sync', {
        method: 'POST',
        body: JSON.stringify({ operations }),
      });
    }
    const payload = await parseResponse<{
      readonly results: readonly {
        operationId: string;
        result: Readonly<Record<string, unknown>>;
        serverRecordedAt: string;
      }[];
    }>(response);
    return {
      checkpoint: payload.results.at(-1)?.serverRecordedAt ?? new Date().toISOString(),
      deviceStatus: 'authorized',
      outcomes: payload.results.map((result) => ({
        operationId: result.operationId,
        status: 'accepted' as const,
        canonicalReference:
          typeof result.result.paymentId === 'string'
            ? result.result.paymentId
            : result.operationId,
        ...(typeof result.result.receiptNumber === 'string'
          ? { canonicalReceiptNumber: result.result.receiptNumber }
          : {}),
        recordedAtServer: result.serverRecordedAt,
      })),
    };
  }

  public async clear(): Promise<void> {
    this.tokens = undefined;
    await SecureStore.deleteItemAsync(TOKENS_KEY);
  }

  private async refresh() {
    const current = this.requireTokens();
    const tokens = await this.request<CollectTokens>('/v1/collect/token/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    await this.store(tokens);
  }

  private authorized(path: string, init: RequestInit = {}) {
    const tokens = this.requireTokens();
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init.headers,
        authorization: `Bearer ${tokens.accessToken}`,
      },
    });
  }

  private request<T>(path: string, init: RequestInit): Promise<T> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    }).then((response) => parseResponse<T>(response));
  }

  private requireTokens(): CollectTokens {
    if (!this.tokens) throw new Error('Collect device authorization is required.');
    return this.tokens;
  }

  private async store(tokens: CollectTokens) {
    this.tokens = tokens;
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? ((payload as { error?: { message?: string } }).error?.message ?? 'Request failed.')
        : 'Request failed.',
    );
  }
  return payload as T;
}

function serializeOperation(operation: OutboxOperation) {
  return {
    operationId: operation.operationId,
    sequence: operation.createdLocalSequence,
    type: operation.type,
    payload: {
      assignmentId: operation.payload.assignmentId,
      amountMinor: operation.payload.amountMinor,
      currency: operation.payload.currency,
      clientRecordedAt: operation.occurredAtDevice,
    },
  };
}

function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
