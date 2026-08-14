import { createHmac } from 'node:crypto';
import type { Permission, VerifiedTenantId } from '@isp/contracts';
import type { SignedOperationsDatabaseContext } from './types.js';

export interface OperationsAttestation {
  readonly keyId: string;
  readonly tenantId: VerifiedTenantId;
  readonly actorId: string;
  readonly sessionId: string;
  readonly supportGrantId?: string;
  readonly permission: Permission;
  readonly action: string;
  readonly requestId: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly branchIds?: readonly string[];
  readonly areaIds?: readonly string[];
  readonly routeIds?: readonly string[];
  readonly recordIds?: readonly string[];
  readonly expiresAt: string;
}

/** Trusted composition helper. Key bytes come from a secret-store reference, never a request. */
export function signOperationsAttestation(
  attestation: OperationsAttestation,
  secret: Uint8Array,
): SignedOperationsDatabaseContext {
  if (secret.byteLength < 32)
    throw new RangeError('Operations context keys require at least 32 bytes.');
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
