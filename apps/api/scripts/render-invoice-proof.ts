import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { invoiceFixture } from '../src/documents/invoice-fixture.js';
import { renderInvoicePdf } from '../src/documents/invoice-pdf.js';

const directory = resolve('../../output/pdf');
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, 'orvex-invoice-sample.pdf'),
  await renderInvoicePdf(invoiceFixture),
);
console.log('Synthetic bilingual invoice proof written to output/pdf/orvex-invoice-sample.pdf');
