import { BaseFakeProvider } from './base.js';
import { ProviderError, type ProviderConfiguration, type ProviderRequestContext } from './types.js';

export class FakeMapsProvider extends BaseFakeProvider {
  async geocode(
    address: string,
    context?: ProviderRequestContext,
  ): Promise<{
    readonly latitude: number;
    readonly longitude: number;
    readonly precision: 'fake';
  }> {
    void context;
    this.assertOperational();
    if (address.trim().length < 3)
      throw new ProviderError('invalid_request', false, 'Address is required.');
    return { latitude: 33.8938, longitude: 35.5018, precision: 'fake' };
  }
}

export interface BluetoothReceipt {
  readonly receiptId: string;
  readonly content: Uint8Array;
  readonly copies: number;
}

export class FakeBluetoothPrinter extends BaseFakeProvider {
  #connected = true;
  setConnected(connected: boolean): void {
    this.#connected = connected;
  }
  async print(receipt: BluetoothReceipt): Promise<{ readonly printJobId: string }> {
    this.assertOperational();
    if (!this.#connected)
      throw new ProviderError('unavailable', true, 'Bluetooth printer is unavailable.');
    if (!Number.isInteger(receipt.copies) || receipt.copies < 1 || receipt.copies > 3) {
      throw new ProviderError(
        'invalid_request',
        false,
        'Receipt copies must be between one and three.',
      );
    }
    return { printJobId: `fake-print-${receipt.receiptId}` };
  }
}

export interface StoredObject {
  readonly objectKey: string;
  readonly checksum: string;
  readonly size: number;
}

function checksum(bytes: Uint8Array): string {
  let value = 0;
  for (const byte of bytes) value = (value * 31 + byte) >>> 0;
  return `fake-${value.toString(16).padStart(8, '0')}`;
}

export class FakeS3ObjectStorage extends BaseFakeProvider {
  readonly #objects = new Map<string, Uint8Array>();
  async put(objectKey: string, content: Uint8Array): Promise<StoredObject> {
    this.assertOperational();
    if (objectKey.includes('..') || objectKey.startsWith('/')) {
      throw new ProviderError('invalid_request', false, 'Object key is invalid.');
    }
    this.#objects.set(objectKey, content.slice());
    return { objectKey, checksum: checksum(content), size: content.byteLength };
  }
  async get(objectKey: string): Promise<Uint8Array | undefined> {
    const content = this.#objects.get(objectKey);
    return content?.slice();
  }
}

export class FakeMalwareScanner extends BaseFakeProvider {
  async scan(
    content: Uint8Array,
  ): Promise<{ readonly verdict: 'clean' | 'infected'; readonly engine: 'fake' }> {
    this.assertOperational();
    const decoded = new TextDecoder().decode(content);
    return {
      verdict: decoded.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'infected' : 'clean',
      engine: 'fake',
    };
  }
}

export interface DnsChange {
  readonly recordType: 'A' | 'AAAA' | 'CNAME' | 'TXT';
  readonly name: string;
  readonly value: string;
  readonly ttlSeconds: number;
}

export class FakeDnsProvider extends BaseFakeProvider {
  readonly #records: DnsChange[] = [];
  async preview(
    change: DnsChange,
  ): Promise<{ readonly change: DnsChange; readonly warnings: readonly string[] }> {
    if (change.ttlSeconds < 60)
      throw new ProviderError('invalid_request', false, 'DNS TTL must be at least 60 seconds.');
    return { change: Object.freeze({ ...change }), warnings: [] };
  }
  async apply(
    change: DnsChange,
    context: ProviderRequestContext,
  ): Promise<{ readonly changeId: string }> {
    this.assertOperational();
    await this.preview(change);
    this.#records.push(Object.freeze({ ...change }));
    return { changeId: `fake-dns-${context.idempotencyKey}` };
  }
}

export class FakeSslProvider extends BaseFakeProvider {
  async inspect(
    hostname: string,
  ): Promise<{ readonly status: 'valid' | 'expiring'; readonly expiresAt: string }> {
    this.assertOperational();
    if (!/^[a-z0-9.-]+$/i.test(hostname))
      throw new ProviderError('invalid_request', false, 'Hostname is invalid.');
    return { status: 'valid', expiresAt: '2027-08-13T00:00:00.000Z' };
  }
}

export function providerNeedsActivation(configuration: ProviderConfiguration): boolean {
  return configuration.mode === 'live' && configuration.enabled;
}
