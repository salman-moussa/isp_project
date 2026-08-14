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
              'remote-address-pool': 'pool-a',
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
              'remote-address-pool': 'pool-a',
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
        'remote-address-pool': 'pool-a',
      },
    ]);
    const observed = JSON.stringify([
      {
        '.id': '*1',
        name: 'alice',
        disabled: 'true',
        profile: 'restricted',
        'remote-address-pool': 'pool-a',
      },
    ]);
    const fetcher: typeof fetch = async (_input, init) => {
      headers.push(new Headers(init?.headers).get('authorization') ?? '');
      call += 1;
      if (call === 1) return new Response(existing, { status: 200 });
      if (call === 2) return new Response('{}', { status: 200 });
      return new Response(observed, { status: 200 });
    };
    const result = await adapter(fetcher).execute(router, 'service-a', action, context);
    expect(result.classification).toBe('definite_success');
    expect(headers).toHaveLength(3);
    expect(headers.every((header) => header.startsWith('Basic '))).toBe(true);
  });
});
