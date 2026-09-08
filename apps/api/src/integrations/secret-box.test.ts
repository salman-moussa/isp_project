import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmSecretBox, SecretBoxError, decodeIntegrationSecretKey } from './secret-box.js';

describe('AesGcmSecretBox', () => {
  const key = randomBytes(32);
  const box = new AesGcmSecretBox(key, 'integration-1');

  it('round-trips credentials and never stores them in the clear', () => {
    const sealed = box.seal({ password: 'hunter2-très-secret', authToken: 'abc' });
    expect(sealed.toString('utf8')).not.toContain('hunter2');
    expect(box.open(sealed, 'integration-1')).toEqual({
      authToken: 'abc',
      password: 'hunter2-très-secret',
    });
  });

  it('produces different ciphertext for the same plaintext but a stable fingerprint', () => {
    const first = box.seal({ password: 'same' });
    const second = box.seal({ password: 'same' });
    expect(first.equals(second)).toBe(false);
    expect(box.fingerprint({ password: 'same' })).toBe(box.fingerprint({ password: 'same' }));
    expect(box.fingerprint({ password: 'same' })).not.toBe(box.fingerprint({ password: 'other' }));
  });

  it('refuses tampered bytes and foreign keys', () => {
    const sealed = box.seal({ password: 'x' });
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => box.open(tampered, 'integration-1')).toThrow(SecretBoxError);
    expect(() => box.open(sealed, 'integration-2')).toThrow(/integration-2/u);
    const other = new AesGcmSecretBox(randomBytes(32), 'integration-1');
    expect(() => other.open(sealed, 'integration-1')).toThrow(SecretBoxError);
  });

  it('validates key material and key ids', () => {
    expect(() => new AesGcmSecretBox(randomBytes(16), 'integration-1')).toThrow('32 bytes');
    expect(() => new AesGcmSecretBox(key, 'bad key')).toThrow('key id');
    expect(() => decodeIntegrationSecretKey('not base64!')).toThrow('canonical base64');
    expect(() => decodeIntegrationSecretKey(randomBytes(16).toString('base64'))).toThrow(
      'exactly 32 bytes',
    );
    expect(Buffer.from(decodeIntegrationSecretKey(key.toString('base64'))).equals(key)).toBe(true);
  });
});
