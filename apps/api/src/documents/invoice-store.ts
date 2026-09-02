import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

const maxBytes = 25 * 1024 * 1024;

export interface InvoiceDocumentStore {
  put(key: string, bytes: Buffer, retentionUntil: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  ready(): Promise<void>;
}

/** Dedicated private bucket, workload credentials, Object Lock, and create-only writes. */
export class S3InvoiceDocumentStore implements InvoiceDocumentStore {
  public constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  public async ready(): Promise<void> {
    const result = await this.client.send(
      new GetObjectLockConfigurationCommand({ Bucket: this.bucket }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
    if (result.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled') {
      throw new Error('Invoice storage requires an Object Lock enabled private bucket.');
    }
  }

  public async put(key: string, bytes: Buffer, retentionUntil: string): Promise<void> {
    validateKey(key);
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Invoice document size invalid.');
    const until = new Date(`${retentionUntil}T23:59:59.999Z`);
    // Historical imports whose policy retention already elapsed still receive one day of protection.
    const retainUntil = new Date(Math.max(until.getTime(), Date.now() + 86_400_000));
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'application/pdf',
          ContentLength: bytes.length,
          IfNoneMatch: '*',
          ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: retainUntil,
        }),
        { abortSignal: AbortSignal.timeout(20_000) },
      );
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
        throw error;
      const existing = await this.get(key);
      if (!existing.equals(bytes)) throw new Error('Immutable invoice object checksum conflict.');
    }
  }

  public async get(key: string): Promise<Buffer> {
    validateKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(20_000) },
    );
    if (
      !response.Body ||
      !response.ContentLength ||
      response.ContentLength > maxBytes ||
      response.ContentType !== 'application/pdf'
    )
      throw new Error('Invoice object metadata invalid.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Invoice object exceeds size limit.');
      chunks.push(Buffer.from(chunk));
    }
    if (size !== response.ContentLength) throw new Error('Invoice object is incomplete.');
    return Buffer.concat(chunks);
  }
}

export function invoiceStorageKey(tenantId: string, artifactId: string): string {
  const key = `tenants/${tenantId}/invoices/${artifactId}.pdf`;
  validateKey(key);
  return key;
}

function validateKey(key: string): void {
  if (!/^tenants\/[0-9a-f-]{36}\/invoices\/[0-9a-f-]{36}\.pdf$/.test(key)) {
    throw new Error('Invalid invoice storage namespace.');
  }
}
