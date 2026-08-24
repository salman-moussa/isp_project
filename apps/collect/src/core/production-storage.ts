import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  getRandomBytesAsync,
} from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type { CollectState } from './model';
import type { DeviceKeyVault, StateDatabaseDriver } from './storage';

const KEY_NAME = 'orvex.collect.state-key.v1';
const STATE_FILE = 'orvex-collect-state-v1.bin';
const NEXT_FILE = `${STATE_FILE}.next`;
const BACKUP_FILE = `${STATE_FILE}.backup`;
const AAD = new TextEncoder().encode('orvex.collect.state/v1');

function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/iu.test(value)) {
    throw new Error('The protected Collect storage key is invalid.');
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function parseState(value: Uint8Array): CollectState {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(value));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Encrypted Collect state has an unsupported or invalid schema.');
  }
  const record = parsed as Record<string, unknown>;
  const sequence = record.nextLocalSequence;
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(sequence) || (sequence as number) < 1) {
    throw new Error('Encrypted Collect state has an unsupported or invalid schema.');
  }
  for (const field of [
    'assignments',
    'payments',
    'outbox',
    'printAttempts',
    'reconciliations',
    'conflicts',
  ] as const) {
    if (!Array.isArray(record[field])) {
      throw new Error(`Encrypted Collect state is missing ${field}.`);
    }
  }
  return record as unknown as CollectState;
}

export class ExpoSecureDeviceKeyVault implements DeviceKeyVault {
  public async getOrCreateDatabaseKey(): Promise<Uint8Array> {
    const existing = await SecureStore.getItemAsync(KEY_NAME);
    if (existing !== null) return fromHex(existing);

    const created = await getRandomBytesAsync(32);
    await SecureStore.setItemAsync(KEY_NAME, toHex(created), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return created;
  }

  public async deleteDatabaseKey(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY_NAME);
  }
}

/**
 * Authenticated, device-key-backed storage for the production Collect composition.
 * A temp/current/backup rotation makes an interrupted replacement recoverable without
 * ever writing plaintext state to the filesystem.
 */
export class ExpoAesGcmStateDriver implements StateDatabaseDriver {
  public readonly encryption = 'aes-gcm-file' as const;
  private key: AESEncryptionKey | undefined;
  private readonly current = new File(Paths.document, STATE_FILE);
  private readonly next = new File(Paths.document, NEXT_FILE);
  private readonly backup = new File(Paths.document, BACKUP_FILE);

  public async open(key: Uint8Array): Promise<void> {
    if (key.byteLength !== 32) throw new Error('Collect storage requires a 256-bit key.');
    this.key = await AESEncryptionKey.import(key);
  }

  private requireKey(): AESEncryptionKey {
    if (this.key === undefined) throw new Error('Collect encrypted storage is not open.');
    return this.key;
  }

  private async decrypt(file: File): Promise<CollectState | undefined> {
    if (!file.exists) return undefined;
    const sealed = AESSealedData.fromCombined(await file.bytes());
    const plaintext = await aesDecryptAsync(sealed, this.requireKey(), {
      output: 'bytes',
      additionalData: AAD,
    });
    return parseState(plaintext);
  }

  public async read(): Promise<CollectState | undefined> {
    let currentFailure: unknown;
    try {
      const current = await this.decrypt(this.current);
      if (current !== undefined) return current;
    } catch (error) {
      currentFailure = error;
      // An interrupted filesystem replacement is recoverable from the authenticated backup.
    }
    try {
      const backup = await this.decrypt(this.backup);
      if (backup !== undefined) return backup;
    } catch (backupFailure) {
      throw new Error('Collect encrypted state and its recovery copy failed authentication.', {
        cause: backupFailure,
      });
    }
    if (currentFailure !== undefined) {
      throw new Error('Collect encrypted state failed authentication and has no recovery copy.', {
        cause: currentFailure,
      });
    }
    return undefined;
  }

  public async replace(nextState: CollectState): Promise<void> {
    const plaintext = new TextEncoder().encode(JSON.stringify(nextState));
    const sealed = await aesEncryptAsync(plaintext, this.requireKey(), {
      additionalData: AAD,
      tagLength: 16,
    });
    const encrypted = await sealed.combined();

    this.next.create({ overwrite: true, intermediates: true });
    this.next.write(encrypted);
    await this.decrypt(this.next);

    if (this.current.exists) await this.current.copy(this.backup, { overwrite: true });
    await this.next.move(this.current, { overwrite: true });
    if (this.backup.exists) this.backup.delete();
  }
}
