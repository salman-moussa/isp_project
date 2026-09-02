import type { ApiSession } from '@isp/ui';
import { useState } from 'react';
import { downloadInvoiceDocument, submitBillingOperation, type BillingWorkspaceData } from '../api';

export function InvoiceArchive({
  locale,
  session,
  workspace,
  reload,
}: {
  readonly locale: 'en' | 'ar';
  readonly session: ApiSession;
  readonly workspace: BillingWorkspaceData | undefined;
  readonly reload: () => Promise<void>;
}) {
  const en = locale === 'en';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  async function perform(invoiceId: string, artifactId?: string) {
    setBusy(true);
    setError(false);
    setDone(false);
    try {
      if (artifactId) {
        const blob = await downloadInvoiceDocument(session, artifactId);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `invoice-${artifactId}.pdf`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        await submitBillingOperation(session, 'invoice-documents', { invoiceId });
        await reload();
      }
      setDone(true);
    } catch {
      setError(true);
      await reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="billing-panel billing-command billing-archive" aria-busy={busy}>
      <h2>{en ? 'Private invoice archive' : 'أرشيف الفواتير الخاص'}</h2>
      <p>
        {en
          ? 'Bilingual PDFs from posted legal snapshots. Last 250 eligible invoices; archived files remain unchanged.'
          : 'ملفات ثنائية اللغة من اللقطات القانونية المرحلة. آخر ٢٥٠ فاتورة مؤهلة؛ الملفات المؤرشفة ثابتة.'}
      </p>
      {error ? (
        <p role="alert">
          {en
            ? 'Document operation failed or access was denied. Check your permissions and storage connection, then retry; no invoice was changed.'
            : 'فشلت عملية المستند أو رُفض الوصول. تحقق من الصلاحيات واتصال التخزين ثم أعد المحاولة؛ لم تتغير الفاتورة.'}
        </p>
      ) : null}
      {done ? (
        <p role="status">{en ? 'Document operation completed.' : 'اكتملت عملية المستند.'}</p>
      ) : null}
      {!workspace ? (
        <p role="status">{en ? 'Loading archive…' : 'جار تحميل الأرشيف…'}</p>
      ) : !workspace.documentStorageConfigured ? (
        <p role="status">
          {en
            ? 'Your operator must configure private document storage before generation or download.'
            : 'يجب على المشغّل إعداد تخزين المستندات الخاص قبل الإنشاء أو التنزيل.'}
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const invoiceId = new FormData(event.currentTarget).get('invoiceId');
          if (typeof invoiceId === 'string' && invoiceId) void perform(invoiceId);
        }}
      >
        <label>
          <span>{en ? 'Posted invoice' : 'الفاتورة المرحلة'}</span>
          <select
            name="invoiceId"
            required
            defaultValue=""
            disabled={busy || !workspace?.documentStorageConfigured}
          >
            <option value="">{en ? 'Select an invoice' : 'اختر فاتورة'}</option>
            {workspace?.documentInvoices?.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.documentNumber}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={
            busy || !workspace?.documentStorageConfigured || !workspace.documentInvoices?.length
          }
        >
          {en ? 'Generate / recover PDF' : 'إنشاء / استعادة PDF'}
        </button>
      </form>
      {workspace && !workspace.invoiceDocuments?.length ? (
        <p>{en ? 'No archived invoices yet.' : 'لا توجد فواتير مؤرشفة بعد.'}</p>
      ) : null}
      {workspace?.invoiceDocuments?.map((item) => (
        <article key={item.id} className="billing-archive-item">
          <strong>{item.documentNumber}</strong>
          <span>
            {en ? `Retain through ${item.retentionUntil}` : `يُحفظ حتى ${item.retentionUntil}`}
          </span>
          <small>
            {item.status === 'ready'
              ? en
                ? 'Archived · checksum verified on download'
                : 'مؤرشفة · يُفحص التكامل عند التنزيل'
              : en
                ? 'Pending · retry generation to recover'
                : 'قيد الانتظار · أعد الإنشاء للاستعادة'}
          </small>
          <button
            type="button"
            disabled={busy || !workspace.documentStorageConfigured}
            onClick={() =>
              void perform(item.invoiceId, item.status === 'ready' ? item.id : undefined)
            }
          >
            {item.status === 'ready'
              ? en
                ? 'Download PDF'
                : 'تنزيل PDF'
              : en
                ? 'Retry generation'
                : 'إعادة الإنشاء'}
          </button>
        </article>
      ))}
    </section>
  );
}
