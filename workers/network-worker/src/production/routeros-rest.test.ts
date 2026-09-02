import { describe, expect, it } from 'vitest';
import type { NetworkAction, RouterCommandContext, RouterRegistration } from '../domain.js';
import { RouterOsRestAdapter, type SecretReferenceResolver } from './routeros-rest.js';

const router: RouterRegistration = {
  tenantId: 'tenant-a',
  routerId: 'router-a',
  endpoint: new URL('https://10.10.10.8:8443/'),
  credentialReference: 'secret://routers/a',
  connector: 'routeros-rest',
  enabled: true,
};
const context: RouterCommandContext = {
  requestId: 'request-a',
  timeoutMs: 20,
  credentialReference: 'secret://routers/a',
};
const action: NetworkAction = {
  kind: 'pppoe.suspend',
  desired: {
    accountName: 'alice',
    enabled: false,
    profileId: 'restricted',
    ipAssignment: { mode: 'dynamic', poolId: 'pool-a' },
  },
};
const secrets: SecretReferenceResolver = {
  resolveRouterOsBasic: async () => ({ username: 'orvex', password: 'router-password-value' }),
  resolveSubscriberPassword: async () => 'subscriber-password-value',
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(body: BodyInit): string {
  if (typeof body !== 'string') throw new Error('Expected a string request body.');
  return body;
}

function adapter(
  fetcher: typeof fetch,
  extra: { maxResponseBytes?: number } = {},
): RouterOsRestAdapter {
  return new RouterOsRestAdapter({
    allowedOrigins: ['https://10.10.10.8:8443'],
    secrets,
    fetch: fetcher,
    ...extra,
  });
}

describe('RouterOsRestAdapter', () => {
  it('classifies an aborted mutation as uncertain timeout', async () => {
    let call = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      call += 1;
      if (call === 1)
        return new Response(
          JSON.stringify([
            {
              '.id': '*1',
              name: 'alice',
              disabled: 'false',
              profile: 'standard',
              comment: 'service-a',
              'remote-address': 'pool-a',
            },
          ]),
          { status: 200 },
        );
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    };
    const result = await adapter(fetcher).execute(router, 'service-a', action, context);
    expect(result).toEqual({
      classification: 'uncertain',
      requestId: 'request-a',
      errorClass: 'timeout',
      safeMessage: 'Router command timed out; its outcome is unknown.',
    });
  });

  it('does not expose Basic credentials in transport errors or outcomes', async () => {
    let call = 0;
    const fetcher: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify([
            {
              '.id': '*1',
              name: 'alice',
              disabled: 'false',
              profile: 'standard',
              comment: 'service-a',
              'remote-address': 'pool-a',
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('router-password-value subscriber-password-value', { status: 401 });
    };
    const result = await adapter(fetcher).execute(router, 'service-a', action, context);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('router-password-value');
    expect(serialized).not.toContain('subscriber-password-value');
    expect(result).toMatchObject({
      classification: 'definite_failure',
      errorClass: 'authentication',
    });
  });

  it('denies non-allowlisted hosts, endpoint paths, and unsafe resource identifiers', async () => {
    const fetcher: typeof fetch = async () => new Response('[]', { status: 200 });
    const client = adapter(fetcher);
    await expect(
      client.observe(
        { ...router, endpoint: new URL('https://router.attacker.invalid/') },
        'service-a',
        context,
      ),
    ).rejects.toThrow('Router observation failed.');
    await expect(
      client.observe(
        { ...router, endpoint: new URL('https://10.10.10.8:8443/rest/') },
        'service-a',
        context,
      ),
    ).rejects.toThrow('Router observation failed.');
    const unsafe = await client.execute(
      router,
      'service-a',
      { ...action, kind: 'session.disconnect', sessionId: '../../system' },
      context,
    );
    expect(unsafe.classification).toBe('uncertain');
  });

  it('rejects malformed and oversized RouterOS responses with safe errors', async () => {
    await expect(
      adapter(async () => new Response('{not-json', { status: 200 })).observe(
        router,
        'service-a',
        context,
      ),
    ).rejects.toThrow('Router observation failed.');
    await expect(
      adapter(async () => new Response('x'.repeat(65), { status: 200 }), {
        maxResponseBytes: 32,
      }).observe(router, 'service-a', context),
    ).rejects.toThrow('Router observation failed.');
  });

  it('uses Basic auth only at the request boundary and reconciles the observed state', async () => {
    const headers: string[] = [];
    let call = 0;
    const existing = JSON.stringify([
      {
        '.id': '*1',
        name: 'alice',
        disabled: 'false',
        profile: 'standard',
        comment: 'service-a',
        'remote-address': 'pool-a',
      },
    ]);
    const observed = JSON.stringify([
      {
        '.id': '*1',
        name: 'alice',
        disabled: 'true',
        profile: 'restricted',
        comment: 'service-a',
        'remote-address': 'pool-a',
      },
    ]);
    const fetcher: typeof fetch = async (_input, init) => {
      headers.push(new Headers(init?.headers).get('authorization') ?? '');
      call += 1;
      if (call === 1) return new Response(existing, { status: 200 });
      if (call === 2) return new Response('{}', { status: 200 });
      if (requestUrl(_input).includes('/ppp/active?')) return new Response('[]', { status: 200 });
      return new Response(observed, { status: 200 });
    };
    const result = await adapter(fetcher).execute(router, 'service-a', action, context);
    expect(result.classification).toBe('definite_success');
    expect(headers).toHaveLength(4);
    expect(headers.every((header) => header.startsWith('Basic '))).toBe(true);
  });
});
describe('RouterOS session safety', () => {
  const liveRecord = {
    '.id': '*1',
    comment: 'service-a',
    name: 'alice',
    disabled: 'false',
    profile: 'standard',
    'remote-address': 'pool-a',
  };
  const disconnect: NetworkAction = {
    kind: 'session.disconnect',
    sessionId: '*A',
    desired: {
      accountName: 'alice',
      enabled: true,
      profileId: 'standard',
      ipAssignment: { mode: 'dynamic', poolId: 'pool-a' },
    },
  };
  it('observes the full active-session list and never treats caller-id as a VLAN', async () => {
    const client = adapter(
      async (input) =>
        new Response(
          JSON.stringify(
            requestUrl(input).includes('/ppp/active?')
              ? [
                  { '.id': '*A', name: 'alice' },
                  { '.id': '*B', name: 'alice' },
                ]
              : [{ ...liveRecord, 'caller-id': 'AA:BB:CC:DD:EE:FF' }],
          ),
          { status: 200 },
        ),
    );
    const state = await client.observe(router, 'service-a', context);
    expect(state).toMatchObject({
      activeSessionIds: ['*A', '*B'],
      ipAssignment: { mode: 'dynamic', poolId: 'pool-a' },
    });
    expect(state).not.toHaveProperty('vlanId');
  });
  it('does not delete a resource belonging to a different subscriber', async () => {
    const methods: string[] = [];
    const client = adapter(async (input, init) => {
      methods.push(init?.method ?? 'GET');
      return new Response(
        JSON.stringify(
          requestUrl(input).includes('/ppp/active?')
            ? [{ '.id': '*B', name: 'alice' }]
            : [liveRecord],
        ),
        { status: 200 },
      );
    });
    expect(await client.execute(router, 'service-a', disconnect, context)).toMatchObject({
      classification: 'definite_failure',
      errorClass: 'invalid_request',
    });
    expect(methods).not.toContain('DELETE');
  });
  it('requires matching returned service ownership even if the router ignores its filter', async () => {
    const methods: string[] = [];
    const client = adapter(async (_input, init) => {
      methods.push(init?.method ?? 'GET');
      return new Response(JSON.stringify([{ ...liveRecord, comment: 'other-service' }]), {
        status: 200,
      });
    });
    await client.execute(router, 'service-a', disconnect, context);
    expect(methods).not.toContain('DELETE');
  });
  it('confirms disappearance of exactly the requested session, allowing a new reconnect', async () => {
    let removed = false;
    const deletes: string[] = [];
    const client = adapter(async (input, init) => {
      if (init?.method === 'DELETE') {
        deletes.push(requestUrl(input));
        removed = true;
        return new Response(null, { status: 204 });
      }
      if (requestUrl(input).includes('/ppp/active?'))
        return new Response(JSON.stringify([{ '.id': removed ? '*B' : '*A', name: 'alice' }]), {
          status: 200,
        });
      return new Response(JSON.stringify([liveRecord]), { status: 200 });
    });
    const result = await client.execute(router, 'service-a', disconnect, context);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/rest/ppp/active/*A');
    expect(result).toMatchObject({
      classification: 'definite_success',
      observed: { activeSessionIds: ['*B'] },
    });
  });
  it('writes pools through remote-address and refuses unsupported VLAN changes before transport', async () => {
    const bodies: Record<string, string>[] = [];
    const client = adapter(async (input, init) => {
      if (init?.body) bodies.push(JSON.parse(requestBody(init.body)) as Record<string, string>);
      return new Response(
        JSON.stringify(requestUrl(input).includes('/ppp/active?') ? [] : [liveRecord]),
        { status: 200 },
      );
    });
    await client.execute(router, 'service-a', action, context);
    expect(bodies[0]).toHaveProperty('remote-address', 'pool-a');
    expect(bodies[0]).not.toHaveProperty('remote-address-pool');
    expect(bodies[0]).not.toHaveProperty('caller-id');
    let calls = 0;
    const denied = await adapter(async () => {
      calls++;
      return new Response('[]');
    }).execute(
      router,
      'service-a',
      { ...action, desired: { ...action.desired, vlanId: '200' } },
      context,
    );
    expect(denied).toMatchObject({ classification: 'definite_failure', retryable: false });
    expect(calls).toBe(0);
  });
  it('resolves inherited pool assignment from the named PPP profile', async () => {
    const client = adapter(
      async (input) =>
        new Response(
          JSON.stringify(
            requestUrl(input).includes('/ppp/profile?')
              ? [{ name: 'standard', 'remote-address': 'inherited-pool' }]
              : requestUrl(input).includes('/ppp/active?')
                ? []
                : [{ ...liveRecord, 'remote-address': '0.0.0.0' }],
          ),
          { status: 200 },
        ),
    );
    expect(await client.observe(router, 'service-a', context)).toMatchObject({
      ipAssignment: { mode: 'dynamic', poolId: 'inherited-pool' },
    });
  });
});
