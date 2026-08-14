import { createEmptyState, type CollectState } from './model.js';

export interface DeviceKeyVault {
  getOrCreateDatabaseKey(): Promise<Uint8Array>;
  deleteDatabaseKey(): Promise<void>;
}

export interface StateDatabaseDriver {
  readonly encryption: 'aes-gcm-file' | 'sqlcipher' | 'test-memory' | 'none';
  open(key: Uint8Array): Promise<void>;
  read(): Promise<CollectState | undefined>;
  replace(next: CollectState): Promise<void>;
}

export interface CollectStore {
  read(): Promise<CollectState>;
  transaction<T>(work: (draft: CollectState) => T | Promise<T>): Promise<T>;
}

function clone(state: CollectState): CollectState {
  return structuredClone(state);
}

export class EncryptedCollectStore implements CollectStore {
  private queue: Promise<void> = Promise.resolve();

  private constructor(private readonly driver: StateDatabaseDriver) {}

  public static async open(input: {
    mode: 'production' | 'development' | 'test';
    keyVault: DeviceKeyVault;
    driver: StateDatabaseDriver;
  }): Promise<EncryptedCollectStore> {
    if (
      input.mode === 'production' &&
      input.driver.encryption !== 'sqlcipher' &&
      input.driver.encryption !== 'aes-gcm-file'
    ) {
      throw new Error(
        'Production Collect storage requires a verified authenticated-encryption driver; plaintext fallback is forbidden.',
      );
    }
    if (input.driver.encryption === 'none') {
      throw new Error('Plaintext Collect storage is forbidden in every mode.');
    }
    const key = await input.keyVault.getOrCreateDatabaseKey();
    if (key.byteLength < 32) {
      throw new Error('The OS-protected database key must contain at least 256 bits.');
    }
    await input.driver.open(key);
    if ((await input.driver.read()) === undefined) {
      await input.driver.replace(createEmptyState());
    }
    return new EncryptedCollectStore(input.driver);
  }

  public async read(): Promise<CollectState> {
    const state = await this.driver.read();
    if (state === undefined) throw new Error('Encrypted Collect state is not initialized.');
    return clone(state);
  }

  public async transaction<T>(work: (draft: CollectState) => T | Promise<T>): Promise<T> {
    let result!: T;
    const prior = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      const current = await this.read();
      result = await work(current);
      await this.driver.replace(clone(current));
      return result;
    } finally {
      release();
    }
  }
}

export class MemoryKeyVault implements DeviceKeyVault {
  private key: Uint8Array | undefined = new Uint8Array(32).fill(7);
  public async getOrCreateDatabaseKey(): Promise<Uint8Array> {
    this.key ??= new Uint8Array(32).fill(7);
    return this.key;
  }
  public async deleteDatabaseKey(): Promise<void> {
    this.key = undefined;
  }
}

export class DurableMemoryDriver implements StateDatabaseDriver {
  public readonly encryption = 'test-memory' as const;
  private opened = false;
  public state: CollectState | undefined;
  public async open(key: Uint8Array): Promise<void> {
    if (key.byteLength < 32) throw new Error('invalid key');
    this.opened = true;
  }
  public async read(): Promise<CollectState | undefined> {
    if (!this.opened) throw new Error('driver is closed');
    return this.state === undefined ? undefined : clone(this.state);
  }
  public async replace(next: CollectState): Promise<void> {
    if (!this.opened) throw new Error('driver is closed');
    this.state = clone(next);
  }
}
