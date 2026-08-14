import type { Permission } from '@isp/contracts';
import { createHmac } from 'node:crypto';
import type { SignedControlDatabaseContext } from './types.js';

export interface ControlContextAttestation {
  readonly keyId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly permission: Permission;
  readonly action: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly reason: string;
  readonly mfaVerifiedAt?: string;
  readonly expiresAt: string;
}

export function signControlContext(
  attestation: ControlContextAttestation,
  secret: Uint8Array,
): SignedControlDatabaseContext {
  if (secret.byteLength < 32)
    throw new RangeError('Control context keys require at least 32 bytes.');
  if (!/^[0-9a-f]{64}$/.test(attestation.requestHash)) {
    throw new RangeError('Control request hashes must be lowercase SHA-256 hex.');
  }
  const attestationText = stableJson(attestation);
  return {
    attestationText,
    signatureHex: createHmac('sha256', secret).update(attestationText, 'utf8').digest('hex'),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
