import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { invoiceStorageKey, S3InvoiceDocumentStore } from './invoice-store.js';

const key = invoiceStorageKey(
  '00000000-0000-4000-8000-00000000000a',
  '10000000-0000-4000-8000-000000000001',
);
const bytes = Buffer.from('%PDF-test');
function setup() {
  const send = vi.fn();
  return {
    send,
    store: new S3InvoiceDocumentStore({ send } as unknown as S3Client, 'private-invoices'),
  };
}
describe('private invoice object storage', () => {
  it('requires create-only writes, compliance retention, and an exact checksum', async () => {
    const { store, send } = setup();
    send.mockResolvedValue({});
    await store.put(key, bytes, '2036-09-02');
    const command = send.mock.calls[0]?.[0] as { input: unknown };
    expect(command.input).toMatchObject({
      Key: key,
      Bucket: 'private-invoices',
      IfNoneMatch: '*',
      ObjectLockMode: 'COMPLIANCE',
      ContentType: 'application/pdf',
      ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
    });
  });
  it('accepts an exact retry but never replaces different existing bytes', async () => {
    const { store, send } = setup();
    const conflict = { $metadata: { httpStatusCode: 412 } };
    send.mockRejectedValueOnce(conflict).mockResolvedValueOnce({
      ContentLength: bytes.length,
      ContentType: 'application/pdf',
      Body: Readable.from([bytes]),
    });
    await expect(store.put(key, bytes, '2036-09-02')).resolves.toBeUndefined();
    send.mockRejectedValueOnce(conflict).mockResolvedValueOnce({
      ContentLength: 3,
      ContentType: 'application/pdf',
      Body: Readable.from([Buffer.from('bad')]),
    });
    await expect(store.put(key, bytes, '2036-09-02')).rejects.toThrow('checksum conflict');
  });
  it('fails closed without Object Lock and rejects bad namespaces or oversized bodies', async () => {
    const { store, send } = setup();
    send.mockResolvedValueOnce({});
    await expect(store.ready()).rejects.toThrow('Object Lock');
    await expect(store.get('../another-tenant')).rejects.toThrow('namespace');
    send.mockResolvedValueOnce({
      ContentLength: 26 * 1024 * 1024,
      ContentType: 'application/pdf',
      Body: Readable.from([]),
    });
    await expect(store.get(key)).rejects.toThrow('metadata');
  });
});
