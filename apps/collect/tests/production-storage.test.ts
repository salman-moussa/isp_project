import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  secrets: new Map<string, string>(),
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: async (key: string) => fixture.secrets.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    fixture.secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    fixture.secrets.delete(key);
  },
}));

vi.mock('expo-crypto', () => {
  class TestKey {
    public constructor(public readonly bytes: Uint8Array) {}
    public static async import(bytes: Uint8Array): Promise<TestKey> {
      return new TestKey(bytes);
    }
  }
  class TestSealedData {
    public constructor(public readonly data: Uint8Array) {}
    public static fromCombined(data: Uint8Array): TestSealedData {
      return new TestSealedData(data);
    }
    public async combined(): Promise<Uint8Array> {
      return this.data;
    }
  }
  return {
    AESEncryptionKey: TestKey,
    AESSealedData: TestSealedData,
    getRandomBytesAsync: async (count: number) => new Uint8Array(count).fill(41),
    aesEncryptAsync: async (plaintext: Uint8Array, key: TestKey) =>
      new TestSealedData(
        Uint8Array.from([
          key.bytes[0] ?? 0,
          ...plaintext.map((byte) => byte ^ (key.bytes[0] ?? 0)),
        ]),
      ),
    aesDecryptAsync: async (sealed: TestSealedData, key: TestKey) => {
      if (sealed.data[0] !== key.bytes[0]) throw new Error('authentication failed');
      return sealed.data.slice(1).map((byte) => byte ^ (key.bytes[0] ?? 0));
    },
  };
});

vi.mock('expo-file-system', () => {
  class TestFile {
    public readonly uri: string;
    public constructor(...parts: unknown[]) {
      this.uri = parts.map(String).join('/');
    }
    public get exists(): boolean {
      return fixture.files.has(this.uri);
    }
    public create(): void {
      fixture.files.set(this.uri, new Uint8Array());
    }
    public write(value: Uint8Array): void {
      fixture.files.set(this.uri, value.slice());
    }
    public async bytes(): Promise<Uint8Array> {
      const value = fixture.files.get(this.uri);
      if (value === undefined) throw new Error('missing file');
      return value.slice();
    }
    public async copy(destination: TestFile): Promise<void> {
      fixture.files.set(destination.uri, await this.bytes());
    }
    public async move(destination: TestFile): Promise<void> {
      fixture.files.set(destination.uri, await this.bytes());
      fixture.files.delete(this.uri);
    }
    public delete(): void {
      fixture.files.delete(this.uri);
    }
  }
  return { File: TestFile, Paths: { document: 'document:' } };
});

import { createEmptyState } from '../src/core/model.js';
import { ExpoAesGcmStateDriver, ExpoSecureDeviceKeyVault } from '../src/core/production-storage.js';
import { EncryptedCollectStore } from '../src/core/storage.js';

describe('Collect production encrypted storage', () => {
  beforeEach(() => {
    fixture.files.clear();
    fixture.secrets.clear();
  });

  it('persists authenticated state across a production reopen without plaintext fallback', async () => {
    const vault = new ExpoSecureDeviceKeyVault();
    const first = await EncryptedCollectStore.open({
      mode: 'production',
      keyVault: vault,
      driver: new ExpoAesGcmStateDriver(),
    });
    await first.transaction((state) => {
      state.nextLocalSequence = 7;
    });

    const reopened = await EncryptedCollectStore.open({
      mode: 'production',
      keyVault: vault,
      driver: new ExpoAesGcmStateDriver(),
    });
    expect((await reopened.read()).nextLocalSequence).toBe(7);
    expect(
      [...fixture.files.values()].some((bytes) =>
        new TextDecoder().decode(bytes).includes('"nextLocalSequence":7'),
      ),
    ).toBe(false);
  });

  it('fails closed on key loss instead of overwriting authenticated evidence', async () => {
    const driver = new ExpoAesGcmStateDriver();
    await driver.open(new Uint8Array(32).fill(3));
    await driver.replace(createEmptyState());

    const wrongKey = new ExpoAesGcmStateDriver();
    await wrongKey.open(new Uint8Array(32).fill(4));
    await expect(wrongKey.read()).rejects.toThrow('failed authentication');
  });
});
