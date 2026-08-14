import {
  ProviderError,
  type ProviderConfiguration,
  type ProviderKind,
  type SecretReference,
} from './types.js';

const secretReferencePattern = /^secret:\/\/[a-z0-9][a-z0-9/_-]{2,255}$/i;

export function assertSecretReference(value: string): asserts value is SecretReference {
  if (!secretReferencePattern.test(value)) {
    throw new ProviderError('configuration', false, 'A secret-manager reference is required.');
  }
}

export function createProviderConfiguration(input: {
  providerId: string;
  kind: ProviderKind;
  mode: ProviderConfiguration['mode'];
  enabled: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  secretReferences?: Readonly<Record<string, string>>;
  endpoint?: string;
  featureFlags?: Readonly<Record<string, boolean>>;
}): ProviderConfiguration {
  if (input.providerId.trim().length === 0)
    throw new ProviderError('configuration', false, 'Provider ID is required.');
  const timeoutMs = input.timeoutMs ?? 5_000;
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new ProviderError(
      'configuration',
      false,
      'Provider timeout must be between 100 and 60000 ms.',
    );
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new ProviderError(
      'configuration',
      false,
      'Provider max attempts must be between 1 and 5.',
    );
  }
  const secretReferences: Record<string, SecretReference> = {};
  for (const [key, value] of Object.entries(input.secretReferences ?? {})) {
    assertSecretReference(value);
    secretReferences[key] = value;
  }
  if (input.mode === 'live' && Object.keys(secretReferences).length === 0) {
    throw new ProviderError(
      'configuration',
      false,
      'Live provider mode requires a secret reference.',
    );
  }
  const endpoint = input.endpoint === undefined ? undefined : new URL(input.endpoint);
  if (input.mode === 'live' && endpoint?.protocol !== 'https:') {
    throw new ProviderError('configuration', false, 'Live provider endpoint must use HTTPS.');
  }
  return Object.freeze({
    providerId: input.providerId,
    kind: input.kind,
    mode: input.mode,
    enabled: input.enabled,
    timeoutMs,
    maxAttempts,
    secretReferences: Object.freeze(secretReferences),
    ...(endpoint === undefined ? {} : { endpoint }),
    featureFlags: Object.freeze({ ...input.featureFlags }),
  });
}

export function assertNoPlaintextSecrets(value: unknown): void {
  const forbidden = /(?:password|api_?key|secret|private_?key|access_?token)/i;
  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null || typeof candidate !== 'object') return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (forbidden.test(key) && !/reference/i.test(key)) {
        throw new ProviderError(
          'configuration',
          false,
          `Plaintext secret-shaped field is forbidden at ${path}${key}.`,
        );
      }
      visit(nested, `${path}${key}.`);
    }
  };
  visit(value, 'configuration.');
}
