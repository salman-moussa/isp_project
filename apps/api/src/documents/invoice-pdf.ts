import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { bidiTextRuns, wrapInvoiceText } from './bidi-text.js';

const regularFont = fileURLToPath(
  new URL('../../assets/fonts/NotoSansArabic.ttf', import.meta.url),
);
const boldFont = regularFont;

const snapshotSchema = z
  .object({
    version: z.number().int().positive(),
    languages: z.array(z.enum(['ar', 'en'])),
    retentionYears: z.number().int().positive(),
    supplier: z.object({
      nameEn: z.string().min(1),
      nameAr: z.string().min(1),
      addressEn: z.string().min(1),
      addressAr: z.string().min(1),
      taxRegistrationNumber: z.string().min(1),
    }),
    recipient: z.object({ name: z.string().min(1), address: z.string().min(1) }),
    invoice: z.object({
      serialNumber: z.string().min(1),
      issuedAt: z.string().datetime({ offset: true }),
      currency: z.enum(['USD', 'LBP']),
    }),
    service: z.object({
      number: z.string().min(1),
      descriptionEn: z.string().min(1),
      descriptionAr: z.string().min(1),
      periodStart: z.iso.date(),
      periodEnd: z.iso.date(),
    }),
    amounts: z.object({
      baseMinor: z.number().int().nonnegative().safe(),
      addonsMinor: z.number().int().nonnegative().safe(),
      overageMinor: z.number().int().nonnegative().safe(),
      grossMinor: z.number().int().nonnegative().safe(),
      discountBasisPoints: z.number().int().nonnegative().safe(),
      discountMinor: z.number().int().nonnegative().safe(),
      taxableMinor: z.number().int().nonnegative().safe(),
      stampDutyMinor: z.number().int().nonnegative().safe(),
      totalMinor: z.number().int().nonnegative().safe(),
    }),
    tax: z.object({
      treatment: z.enum(['taxable', 'exempt', 'out_of_scope']).default('taxable'),
      rateBasisPoints: z.number().int().nonnegative().safe(),
      amountMinor: z.number().int().nonnegative().safe(),
      reasonEn: z.string().optional(),
      reasonAr: z.string().optional(),
      authorityReference: z.string().optional(),
    }),
  })
  .superRefine((snapshot, context) => {
    const a = snapshot.amounts;
    if (
      a.grossMinor !== a.baseMinor + a.addonsMinor + a.overageMinor ||
      a.taxableMinor !== a.grossMinor - a.discountMinor ||
      a.totalMinor !== a.taxableMinor + snapshot.tax.amountMinor + a.stampDutyMinor
    ) {
      context.addIssue({
        code: 'custom',
        path: ['amounts'],
        message: 'Invoice snapshot totals do not reconcile.',
      });
    }
    if (
      snapshot.tax.treatment !== 'taxable' &&
      (snapshot.tax.rateBasisPoints !== 0 ||
        snapshot.tax.amountMinor !== 0 ||
        !snapshot.tax.reasonEn ||
        !snapshot.tax.reasonAr ||
        !snapshot.tax.authorityReference)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tax'],
        message: 'Non-taxable invoices require bilingual authority evidence and zero VAT.',
      });
    }
  });

export type LegalInvoiceSnapshot = z.infer<typeof snapshotSchema>;

export async function renderInvoicePdf(source: unknown): Promise<Buffer> {
  const invoice = snapshotSchema.parse(source);
  const chunks: Buffer[] = [];
  const issuedAt = new Date(invoice.invoice.issuedAt);
  const document = new PDFDocument({
    autoFirstPage: false,
    compress: false,
    bufferPages: true,
    info: {
      Title: `Invoice ${invoice.invoice.serialNumber}`,
      Author: invoice.supplier.nameEn,
      Subject: 'Bilingual legal invoice archive',
      Creator: 'Orvex ISP deterministic invoice renderer v1',
      Producer: 'Orvex ISP',
      CreationDate: issuedAt,
      ModDate: issuedAt,
    },
  });
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  document.registerFont('OrvexRegular', regularFont);
  document.registerFont('OrvexBold', boldFont);
  document.addPage({ size: 'A4', margins: { top: 0, left: 0, right: 0, bottom: 0 } });
  paintInvoice(document, invoice);
  document.end();
  return completed;
}

function paintInvoice(doc: PDFKit.PDFDocument, invoice: LegalInvoiceSnapshot): void {
  const left = 42;
  const width = 511;
  let y = 120;
  const ink = '#14253a';
  const muted = '#53677d';
  const blue = '#185adb';
  let page = 1;
  const text = (
    value: string,
    x: number,
    top: number,
    w: number,
    size = 10,
    color = ink,
    align: 'left' | 'right' = 'left',
  ) => {
    doc.font('OrvexRegular').fontSize(size).fillColor(color);
    const measure = (part: string) => doc.widthOfString(part, { features: [] });
    const lines = wrapInvoiceText(value, w, measure);
    const lineHeight = doc.currentLineHeight(true);
    lines.forEach((line, index) => {
      const runs = bidiTextRuns(line);
      const widths = runs.map(measure);
      const total = widths.reduce((sum, value) => sum + value, 0);
      let cursor = align === 'right' ? x + w - total : x;
      runs.forEach((run, runIndex) => {
        doc.text(run, cursor, top + index * lineHeight, { lineBreak: false, features: [] });
        cursor += widths[runIndex] ?? 0;
      });
    });
    return lines.length * lineHeight;
  };
  const header = () => {
    doc.rect(0, 0, 595.28, 91).fill('#10223a');
    text('ORVEX ISP', left, 24, 200, 19, '#ffffff');
    text('INVOICE', 365, 21, 188, 22, '#ffffff', 'right');
    text('فاتورة', 365, 51, 188, 13, '#c4d5ed', 'right');
    text('BILLING DOCUMENT', left, 54, 240, 9, '#c4d5ed');
  };
  const ensure = (height: number) => {
    if (y + height <= 758) return;
    doc.addPage({ size: 'A4', margins: { top: 0, left: 0, right: 0, bottom: 0 } });
    page += 1;
    header();
    y = 116;
  };
  const section = (en: string, ar: string) => {
    ensure(65);
    doc.rect(left, y, width, 28).fill('#edf4ff');
    text(en, left + 12, y + 5, 250, 9, blue);
    text(ar, left + 270, y + 3, 229, 10, blue, 'right');
    y += 38;
  };
  const block = (value: string, align: 'left' | 'right' = 'left', color = ink) => {
    // Complete legal text is wrapped, never ellipsized or silently clipped.
    doc.font('OrvexRegular').fontSize(10);
    const height =
      wrapInvoiceText(value, width, (part) => doc.widthOfString(part, { features: [] })).length *
      doc.currentLineHeight(true);
    ensure(height + 6);
    y += text(value, left, y, width, 10, color, align) + 6;
  };
  header();
  text('INVOICE NUMBER', left, y, 250, 8, muted);
  text('رقم الفاتورة', 312, y, 241, 9, muted, 'right');
  y += 19;
  block(invoice.invoice.serialNumber);
  text('ISSUED / ' + issuedDate(invoice.invoice.issuedAt), left, y, 320, 9, muted);
  text(invoice.invoice.currency, 412, y, 141, 11, ink, 'right');
  y += 30;

  section('SUPPLIER', 'المورّد');
  block(invoice.supplier.nameEn);
  block(invoice.supplier.nameAr, 'right');
  block(invoice.supplier.addressEn, 'left', muted);
  block(invoice.supplier.addressAr, 'right', muted);
  block('Tax registration: ' + invoice.supplier.taxRegistrationNumber, 'left', muted);
  section('BILL TO', 'الفاتورة إلى');
  block(invoice.recipient.name, /[\u0600-\u06ff]/.test(invoice.recipient.name) ? 'right' : 'left');
  block(
    invoice.recipient.address,
    /[\u0600-\u06ff]/.test(invoice.recipient.address) ? 'right' : 'left',
    muted,
  );
  section('SERVICE DETAILS', 'تفاصيل الخدمة');
  block(invoice.service.descriptionEn);
  block(invoice.service.descriptionAr, 'right');
  block(
    'Service ' +
      invoice.service.number +
      ' | ' +
      invoice.service.periodStart +
      ' to ' +
      invoice.service.periodEnd,
    'left',
    muted,
  );

  // Keep the summary together; extended identity/evidence flows onto additional numbered pages.
  ensure(356);
  section('AMOUNT SUMMARY', 'ملخص المبالغ');
  const rows: readonly [string, string, number][] = [
    ['Base service', 'الخدمة الأساسية', invoice.amounts.baseMinor],
    ['Add-ons', 'الإضافات', invoice.amounts.addonsMinor],
    ['Usage overage', 'الاستخدام الإضافي', invoice.amounts.overageMinor],
    ['Gross amount', 'المبلغ الإجمالي', invoice.amounts.grossMinor],
    ['Discount', 'الخصم', -invoice.amounts.discountMinor],
    ['Net before tax', 'الصافي قبل الضريبة', invoice.amounts.taxableMinor],
    [
      'VAT ' + (invoice.tax.rateBasisPoints / 100).toFixed(2) + '%',
      'ضريبة القيمة المضافة',
      invoice.tax.amountMinor,
    ],
    ['Stamp duty', 'رسم الطابع', invoice.amounts.stampDutyMinor],
  ];
  rows.forEach(([en, ar, amount], index) => {
    doc.rect(left, y, width, 31).fill(index % 2 ? '#ffffff' : '#f5f8fc');
    text(en, left + 12, y + 6, 174, 9);
    text(ar, left + 183, y + 4, 177, 10, muted, 'right');
    text(money(amount, invoice.invoice.currency), left + 369, y + 6, 130, 10, ink, 'right');
    y += 31;
  });
  y += 12;
  doc.roundedRect(left, y, width, 52, 8).fill('#10223a');
  text('TOTAL', left + 12, y + 13, 120, 13, '#ffffff');
  text('الإجمالي', left + 145, y + 11, 145, 13, '#c4d5ed', 'right');
  text(
    money(invoice.amounts.totalMinor, invoice.invoice.currency),
    left + 310,
    y + 10,
    189,
    18,
    '#ffffff',
    'right',
  );
  y += 69;
  section('TAX TREATMENT', 'المعاملة الضريبية');
  const treatments = {
    taxable: ['Taxable', 'خاضعة للضريبة'],
    exempt: ['VAT exempt', 'معفاة من الضريبة'],
    out_of_scope: ['Outside VAT scope', 'خارج نطاق الضريبة'],
  } as const;
  block(treatments[invoice.tax.treatment][0]);
  block(treatments[invoice.tax.treatment][1], 'right');
  if (invoice.tax.treatment !== 'taxable') {
    block(invoice.tax.reasonEn ?? '');
    block(invoice.tax.reasonAr ?? '', 'right');
    block(invoice.tax.authorityReference ?? '', 'left', muted);
  }
  for (let index = 0; index < page; index += 1) {
    doc.switchToPage(index);
    doc.moveTo(left, 784).lineTo(553, 784).strokeColor('#dce5ef').stroke();
    text(
      'Orvex ISP | Immutable invoice snapshot | Retention: ' + invoice.retentionYears + ' years',
      left,
      797,
      435,
      7,
      muted,
    );
    text(index + 1 + ' / ' + page, 483, 797, 70, 8, muted, 'right');
  }
}

function money(minor: number, currency: 'USD' | 'LBP'): string {
  const value = currency === 'USD' ? minor / 100 : minor;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(value);
}

function issuedDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'Asia/Beirut' }).format(
    new Date(value),
  );
}
