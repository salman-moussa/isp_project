import type { VerifiedTenantId } from '@isp/contracts';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PostgresOperationsService,
  type OperationsRepositoryAdapter,
} from '../operations-service.js';
import type { OperationsMutationContext } from '../routes/operations/contracts.js';
import { invoiceFixture } from './invoice-fixture.js';
import { invoiceStorageKey } from './invoice-store.js';

const tenantId = '00000000-0000-4000-8000-00000000000a' as VerifiedTenantId;
const artifactId = '10000000-0000-4000-8000-000000000001';
const context: OperationsMutationContext = {
  actorId: 'actor',
  sessionId: 'session',
  idempotencyKey: 'document-001',
  requestId: 'request',
  ipAddress: '127.0.0.1',
  permission: 'tenant.invoice.create',
  auditAction: 'tenant.invoice.document.generate',
  reason: 'Invoice archive generation',
};
const archive = {
  id: artifactId,
  invoiceId: artifactId,
  documentNumber: 'INV-1',
  status: 'pending' as const,
  rendererVersion: 'orvex-invoice-pdf-v1',
  retentionUntil: '2036-09-02',
  legalInvoiceSnapshot: invoiceFixture,
};
function setup() {
  const repository = {
    prepareInvoiceDocument: vi.fn(async () => archive),
    completeInvoiceDocument: vi.fn(async () => ({ ...archive, status: 'ready' })),
    readInvoiceDocument: vi.fn(),
  };
  const store = { put: vi.fn(async () => {}), get: vi.fn(), ready: vi.fn(async () => {}) };
  const service = new PostgresOperationsService(
    {} as never,
    { keyId: 'operations-v1', secret: Buffer.from('0123456789abcdef0123456789abcdef') },
    () => new Date('2026-09-02T08:00:00.000Z'),
    repository as unknown as OperationsRepositoryAdapter,
    store,
  );
  return { service, repository, store };
}
describe('invoice archive service', () => {
  it('leaves pending metadata recoverable on storage failure and finalizes only after storage succeeds', async () => {
    const { service, repository, store } = setup();
    store.put.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(
      service.generateInvoiceDocument(tenantId, { ...context, invoiceId: artifactId }),
    ).rejects.toThrow('Storage unavailable');
    expect(repository.completeInvoiceDocument).not.toHaveBeenCalled();
    await service.generateInvoiceDocument(tenantId, { ...context, invoiceId: artifactId });
    expect(repository.completeInvoiceDocument).toHaveBeenCalledWith(
      expect.anything(),
      tenantId,
      expect.objectContaining({
        artifactId,
        storageKey: invoiceStorageKey(tenantId, artifactId),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      }),
    );
  });
  it('rejects namespace or checksum tampering before returning bytes', async () => {
    const { service, repository, store } = setup();
    repository.readInvoiceDocument.mockResolvedValue({
      archive,
      storageKey: 'tenants/other/invoices/file.pdf',
    });
    await expect(
      service.downloadInvoiceDocument(tenantId, { ...context, artifactId }),
    ).rejects.toThrow('namespace');
    expect(store.get).not.toHaveBeenCalled();
    const bytes = Buffer.from('%PDF-check');
    repository.readInvoiceDocument.mockResolvedValue({
      archive: {
        ...archive,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      storageKey: invoiceStorageKey(tenantId, artifactId),
    });
    store.get.mockResolvedValue(Buffer.from('corrupt'));
    await expect(
      service.downloadInvoiceDocument(tenantId, { ...context, artifactId }),
    ).rejects.toThrow('integrity');
    store.get.mockResolvedValue(bytes);
    expect(
      (await service.downloadInvoiceDocument(tenantId, { ...context, artifactId })).bytes,
    ).toEqual(bytes);
  });
});
