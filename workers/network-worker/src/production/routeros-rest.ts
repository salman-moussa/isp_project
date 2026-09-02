import { isIP } from 'node:net';
import type {
  NetworkAction,
  PppoeObservedState,
  RouterAdapter,
  RouterCommandContext,
  RouterCommandOutcome,
  RouterHealth,
  RouterRegistration,
  SecretReference,
  SubscriberServiceId,
} from '../domain.js';

export interface RouterOsBasicCredential {
  readonly username: string;
  readonly password: string;
}

export interface SecretReferenceResolver {
  resolveRouterOsBasic(reference: SecretReference): Promise<RouterOsBasicCredential>;
  resolveSubscriberPassword(reference: SecretReference): Promise<string>;
}

export interface RouterOsRestOptions {
  readonly allowedOrigins: readonly string[];
  readonly secrets: SecretReferenceResolver;
  readonly fetch?: typeof fetch;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxRecords?: number;
  readonly now?: () => Date;
}

type RouterRecord = Record<string, string>;

const SAFE_RESOURCE = /^\*?[A-Za-z0-9_-]{1,64}$/;

function safeResourceSegment(value: string): string {
  if (!SAFE_RESOURCE.test(value)) throw new Error('Router resource identifier is not allowed.');
  return encodeURIComponent(value);
}

function requireString(record: RouterRecord, key: string, maxLength = 256): string {
  const value = record[key];
  if (value === undefined || value.length > maxLength) {
    throw new Error('Router returned a malformed response.');
  }
  return value;
}

function optionalString(record: RouterRecord, key: string, maxLength = 256): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value.length > maxLength) throw new Error('Router returned a malformed response.');
  return value;
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Router returned a malformed response.');
}

function recordToObserved(
  record: RouterRecord,
  sampledAt: string,
  activeSessionIds: readonly string[],
): PppoeObservedState {
  const remoteAddress = optionalString(record, 'remote-address');
  if (!remoteAddress || remoteAddress === '0.0.0.0')
    throw new Error('Effective PPP address assignment is unavailable.');
  return {
    accountName: requireString(record, 'name', 128),
    enabled: !parseBoolean(requireString(record, 'disabled', 5)),
    profileId: requireString(record, 'profile', 128),
    ipAssignment: isIP(remoteAddress)
      ? { mode: 'static', address: remoteAddress }
      : { mode: 'dynamic', poolId: remoteAddress },
    activeSessionIds,
    ...(activeSessionIds.length === 1 ? { activeSessionId: activeSessionIds[0] } : {}),
    sampledAt,
  };
}

async function readBoundedBody(response: Response, limit: number): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error('Router response exceeded the configured limit.');
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseRecords(body: string, maxRecords: number): readonly RouterRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Router returned a malformed response.');
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  if (records.length > maxRecords) throw new Error('Router returned too many records.');
  return records.map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Router returned a malformed response.');
    }
    const record: RouterRecord = {};
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
      if (key.length > 64 || typeof field !== 'string' || field.length > 1_024) {
        throw new Error('Router returned a malformed response.');
      }
      record[key] = field;
    }
    return record;
  });
}

export class RouterOsRestAdapter implements RouterAdapter {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #fetch: typeof fetch;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;
  readonly #maxRecords: number;
  readonly #now: () => Date;

  constructor(private readonly options: RouterOsRestOptions) {
    this.#allowedOrigins = new Set(
      options.allowedOrigins.map((value) => {
        const url = new URL(value);
        if (
          url.protocol !== 'https:' ||
          url.username !== '' ||
          url.password !== '' ||
          url.pathname !== '/' ||
          url.search !== '' ||
          url.hash !== ''
        ) {
          throw new Error('Router allowlist entries must be HTTPS origins.');
        }
        return url.origin;
      }),
    );
    this.#fetch = options.fetch ?? fetch;
    this.#maxRequestBytes = options.maxRequestBytes ?? 16 * 1_024;
    this.#maxResponseBytes = options.maxResponseBytes ?? 64 * 1_024;
    this.#maxRecords = options.maxRecords ?? 50;
    this.#now = options.now ?? (() => new Date());
  }

  #assertRegistration(registration: RouterRegistration): void {
    const endpoint = registration.endpoint;
    if (
      registration.connector !== 'routeros-rest' ||
      endpoint.protocol !== 'https:' ||
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      endpoint.pathname !== '/' ||
      endpoint.search !== '' ||
      endpoint.hash !== '' ||
      !this.#allowedOrigins.has(endpoint.origin)
    ) {
      throw new Error('Router endpoint is not allowed for RouterOS REST.');
    }
  }

  async #request(
    registration: RouterRegistration,
    context: RouterCommandContext,
    method: 'GET' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: Readonly<Record<string, string>>,
  ): Promise<{ readonly status: number; readonly records: readonly RouterRecord[] }> {
    this.#assertRegistration(registration);
    if (!path.startsWith('/rest/') || path.includes('..') || path.includes('\\')) {
      throw new Error('Router command path is not allowed.');
    }
    const credential = await this.options.secrets.resolveRouterOsBasic(context.credentialReference);
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (
      serializedBody !== undefined &&
      Buffer.byteLength(serializedBody, 'utf8') > this.#maxRequestBytes
    ) {
      throw new Error('Router command body exceeded the configured limit.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
      const response = await this.#fetch(new URL(path, registration.endpoint), {
        method,
        redirect: 'error',
        signal: context.signal
          ? AbortSignal.any([controller.signal, context.signal])
          : controller.signal,
        headers: {
          authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-orvex-request-id': context.requestId,
        },
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
      });
      const responseBody = await readBoundedBody(response, this.#maxResponseBytes);
      return {
        status: response.status,
        records:
          responseBody === '' || response.status < 200 || response.status >= 300
            ? []
            : parseRecords(responseBody, this.#maxRecords),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async #findSecret(
    registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    context: RouterCommandContext,
  ): Promise<RouterRecord | undefined> {
    const query = new URLSearchParams({
      comment: subscriberServiceId,
      '.proplist': '.id,name,comment,disabled,profile,remote-address',
    });
    const response = await this.#request(
      registration,
      context,
      'GET',
      `/rest/ppp/secret?${query.toString()}`,
    );
    if (response.status === 404) return undefined;
    if (response.status < 200 || response.status >= 300)
      throw new Error('Router observation failed.');
    if (response.records.length > 1) throw new Error('Router returned ambiguous subscriber state.');
    const record = response.records[0];
    if (record && record.comment !== subscriberServiceId)
      throw new Error('Router subscriber ownership tag mismatch.');
    return record;
  }

  async probe(registration: RouterRegistration): Promise<RouterHealth> {
    const startedAt = Date.now();
    const context: RouterCommandContext = {
      requestId: `probe-${startedAt}`,
      timeoutMs: 5_000,
      credentialReference: registration.credentialReference,
    };
    try {
      const response = await this.#request(registration, context, 'GET', '/rest/system/resource');
      if (response.status < 200 || response.status >= 300 || response.records.length !== 1) {
        throw new Error('Router health check failed.');
      }
      const record = response.records[0]!;
      const parsePercent = (value: string | undefined): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
      };
      return {
        available: true,
        cpuPercent: parsePercent(record['cpu-load']),
        memoryUsedPercent: parsePercent(record['memory-used-percent']),
        uptimeSeconds: Number(record['uptime-seconds'] ?? 0),
        latencyMs: Date.now() - startedAt,
        routerClock: record['router-clock'] ?? this.#now().toISOString(),
        checkedAt: this.#now().toISOString(),
      };
    } catch {
      throw new Error('Router health check failed.');
    }
  }

  async observe(
    registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    context: RouterCommandContext,
  ): Promise<PppoeObservedState | undefined> {
    try {
      const record = await this.#findSecret(registration, subscriberServiceId, context);
      if (!record) return undefined;
      if (!record['remote-address'] || record['remote-address'] === '0.0.0.0') {
        const query = new URLSearchParams({
          name: requireString(record, 'profile', 128),
          '.proplist': 'name,remote-address',
        });
        const profile = await this.#request(
          registration,
          context,
          'GET',
          `/rest/ppp/profile?${query.toString()}`,
        );
        if (
          profile.status !== 200 ||
          profile.records.length !== 1 ||
          profile.records[0]?.name !== record.profile
        )
          throw new Error('Effective PPP profile is unavailable.');
        record['remote-address'] = profile.records[0]?.['remote-address'] ?? '';
      }
      const active = await this.#activeSessions(
        registration,
        requireString(record, 'name', 128),
        context,
      );
      return recordToObserved(
        record,
        this.#now().toISOString(),
        active.map((s) => requireString(s, '.id', 64)),
      );
    } catch {
      throw new Error('Router observation failed.');
    }
  }

  async #activeSessions(
    registration: RouterRegistration,
    accountName: string,
    context: RouterCommandContext,
  ) {
    const query = new URLSearchParams({ name: accountName, '.proplist': '.id,name' });
    const result = await this.#request(
      registration,
      context,
      'GET',
      `/rest/ppp/active?${query.toString()}`,
    );
    if (result.status !== 200 || result.records.some((r) => r.name !== accountName))
      throw new Error('Active session ownership could not be verified.');
    for (const record of result.records) safeResourceSegment(requireString(record, '.id', 64));
    return result.records;
  }

  async execute(
    registration: RouterRegistration,
    subscriberServiceId: SubscriberServiceId,
    action: NetworkAction,
    context: RouterCommandContext,
  ): Promise<RouterCommandOutcome> {
    const startedAt = Date.now();
    try {
      if (action.desired.vlanId !== undefined)
        return {
          classification: 'definite_failure',
          requestId: context.requestId,
          errorClass: 'invalid_request',
          retryable: false,
          safeMessage:
            'VLAN configuration requires an interface-aware adapter; PPP caller-id is not a VLAN field.',
        };
      if (action.kind === 'session.disconnect') safeResourceSegment(action.sessionId);
      const existing = await this.#findSecret(registration, subscriberServiceId, context);
      if (existing && existing.name !== action.desired.accountName)
        return {
          classification: 'definite_failure',
          requestId: context.requestId,
          errorClass: 'invalid_request',
          retryable: false,
          safeMessage: 'Desired PPP account does not match the managed service.',
        };
      let method: 'PUT' | 'PATCH' | 'DELETE';
      let path: string;
      let body: Record<string, string> | undefined;
      if (action.kind === 'session.disconnect') {
        if (!existing)
          return {
            classification: 'definite_failure',
            requestId: context.requestId,
            errorClass: 'invalid_request',
            retryable: false,
            safeMessage: 'Managed PPP service is missing.',
          };
        const sessions = await this.#activeSessions(
          registration,
          action.desired.accountName,
          context,
        );
        if (!sessions.some((s) => s['.id'] === action.sessionId)) {
          return {
            classification: 'definite_failure',
            requestId: context.requestId,
            errorClass: 'invalid_request',
            retryable: false,
            safeMessage: 'Target session is not active for this managed service.',
          };
        }
        method = 'DELETE';
        path = `/rest/ppp/active/${safeResourceSegment(action.sessionId)}`;
      } else {
        if (existing === undefined && action.kind !== 'pppoe.create') {
          return {
            classification: 'definite_failure',
            requestId: context.requestId,
            errorClass: 'invalid_request',
            retryable: false,
            safeMessage: 'Router subscriber resource does not exist.',
          };
        }
        method = existing === undefined ? 'PUT' : 'PATCH';
        path =
          existing === undefined
            ? '/rest/ppp/secret'
            : `/rest/ppp/secret/${safeResourceSegment(requireString(existing, '.id', 64))}`;
        body = {
          name: action.desired.accountName,
          profile: action.desired.profileId,
          disabled: action.desired.enabled ? 'false' : 'true',
          comment: subscriberServiceId,
          ...(action.desired.ipAssignment.mode === 'static'
            ? { 'remote-address': action.desired.ipAssignment.address }
            : { 'remote-address': action.desired.ipAssignment.poolId }),
        };
        if (action.kind === 'pppoe.create' || action.kind === 'pppoe.password.change') {
          body.password = await this.options.secrets.resolveSubscriberPassword(
            action.passwordSecretReference,
          );
        }
      }
      const response = await this.#request(registration, context, method, path, body);
      if (response.status === 401 || response.status === 403) {
        return {
          classification: 'definite_failure',
          requestId: context.requestId,
          errorClass: response.status === 401 ? 'authentication' : 'authorization',
          retryable: false,
          safeMessage: 'Router rejected the command authorization.',
        };
      }
      if (response.status >= 400 && response.status < 500) {
        return {
          classification: 'definite_failure',
          requestId: context.requestId,
          errorClass: 'invalid_request',
          retryable: false,
          safeMessage: 'Router rejected the command request.',
        };
      }
      if (response.status < 200 || response.status >= 300) {
        return {
          classification: 'uncertain',
          requestId: context.requestId,
          errorClass: 'transport',
          safeMessage: 'Router command outcome is unknown.',
        };
      }
      const observed = await this.observe(registration, subscriberServiceId, context);
      if (observed === undefined) {
        return {
          classification: 'uncertain',
          requestId: context.requestId,
          errorClass: 'transport',
          safeMessage: 'Router command outcome could not be reconciled.',
        };
      }
      return {
        classification: 'definite_success',
        requestId: context.requestId,
        observed,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      return {
        classification: 'uncertain',
        requestId: context.requestId,
        errorClass:
          error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'transport',
        safeMessage:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Router command timed out; its outcome is unknown.'
            : 'Router transport failed; command outcome is unknown.',
      };
    }
  }
}
