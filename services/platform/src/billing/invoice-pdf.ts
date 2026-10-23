/**
 * The GST tax invoice as a PDF (PLAN.md §19.31): the same content as the printable invoice screen
 * (apps/web/src/features/billing/invoice.tsx): seller and buyer with GSTIN, number / date / period / place of
 * supply, lines with SAC, CGST + SGST or IGST, total in figures (₹, Indian grouping) and words, paid status.
 */
import { inr, PdfPage, renderPdf } from '../common/pdf';
import type { GstParty } from '../db/schema';

export interface InvoiceForPdf {
  number: string;
  issuedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  seller: GstParty;
  buyer: GstParty;
  placeOfSupply: string;
  reverseCharge: boolean;
  lines: Array<{ description: string; sac: string; quantity: number; unitPrice: number; amount: number; periodStart: string | null; periodEnd: string | null }>;
  subtotal: number;
  cgstRate: number;
  cgst: number;
  sgstRate: number;
  sgst: number;
  igstRate: number;
  igst: number;
  total: number;
  status: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "22 Oct 2026" in India time. */
export function day(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(new Date(isoString).getTime() + 330 * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (v: number) => (v < 20 ? ONES[v]! : `${TENS[Math.floor(v / 10)]}${v % 10 ? ` ${ONES[v % 10]}` : ''}`);
const below1000 = (v: number) => [Math.floor(v / 100) ? `${ONES[Math.floor(v / 100)]} Hundred` : '', v % 100 ? below100(v % 100) : ''].filter(Boolean).join(' ');
/** Whole number in Indian words (crore, lakh, thousand), as the invoice screen writes it. */
export function numberInWords(v: number): string {
  v = Math.floor(Math.abs(v));
  if (v === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(v / 10_000_000);
  v %= 10_000_000;
  const lakh = Math.floor(v / 100_000);
  v %= 100_000;
  const thousand = Math.floor(v / 1000);
  v %= 1000;
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (v) parts.push(below1000(v));
  return parts.join(' ');
}
export function inrInWords(paise: number): string {
  const p = Math.round(Math.abs(paise));
  const rest = p % 100;
  return `Rupees ${numberInWords(Math.floor(p / 100))}${rest ? ` and ${below100(rest)} Paise` : ''} Only`;
}

export function invoicePdf(inv: InvoiceForPdf): Buffer {
  const pages: PdfPage[] = [];
  let pg = new PdfPage();
  pages.push(pg);
  const L = 48;
  const R = pg.width - 48;
  let y = 64;

  // Header
  pg.text(L, y, 'Tax invoice', { size: 20, bold: true });
  pg.text(L, y + 16, `Reverse charge: ${inv.reverseCharge ? 'yes' : 'no'}`, { size: 9, gray: 0.4 });
  const paid = inv.status === 'paid';
  pg.text(R, y - 4, paid ? 'PAID' : inv.status.toUpperCase(), { size: 12, bold: true, align: 'right', gray: paid ? 0.2 : 0 });
  const meta: [string, string][] = [
    ['Invoice no.', inv.number],
    ['Date', day(inv.issuedAt)],
    ...(inv.periodStart ? ([['Period', `${day(inv.periodStart)} – ${day(inv.periodEnd)}`]] as [string, string][]) : []),
    ['Place of supply', inv.placeOfSupply || inv.buyer.state || '—'],
  ];
  let my = y + 14;
  for (const [k, v] of meta) {
    pg.text(R - 150, my, k, { size: 9, gray: 0.4 });
    pg.text(R, my, v, { size: 9, bold: k === 'Invoice no.', align: 'right' });
    my += 13;
  }
  y = Math.max(y + 34, my) + 6;
  pg.line(L, y, R, y);
  y += 18;

  // Parties
  const party = (x: number, title: string, p: GstParty) => {
    let py = y;
    pg.text(x, py, title.toUpperCase(), { size: 8, bold: true, gray: 0.4 });
    py += 14;
    pg.text(x, py, p.name || '—', { size: 10, bold: true });
    py += 13;
    for (const line of p.address ? PdfPage.wrap(p.address, 230, 9) : []) {
      pg.text(x, py, line, { size: 9 });
      py += 12;
    }
    if (p.state) {
      pg.text(x, py, `State: ${p.state}`, { size: 9 });
      py += 12;
    }
    pg.text(x, py, `GSTIN: ${p.gstin || 'Unregistered'}`, { size: 9 });
    py += 12;
    if (p.email) {
      pg.text(x, py, p.email, { size: 9 });
      py += 12;
    }
    return py;
  };
  y = Math.max(party(L, 'Seller', inv.seller), party(L + 260, 'Bill to', inv.buyer)) + 8;
  pg.line(L, y, R, y);
  y += 10;

  // Lines
  const cols = { desc: L + 6, sac: L + 270, qty: L + 350, rate: L + 420, amount: R - 6 };
  const head = () => {
    pg.box(L, y, R - L, 20, 0.94);
    for (const [label, x, align] of [
      ['DESCRIPTION', cols.desc, 'left'],
      ['SAC', cols.sac, 'left'],
      ['QTY', cols.qty, 'right'],
      ['RATE (Rs.)', cols.rate, 'right'],
      ['AMOUNT (Rs.)', cols.amount, 'right'],
    ] as const)
      pg.text(x, y + 13.5, label, { size: 8, bold: true, gray: 0.3, align });
    y += 28;
  };
  head();
  for (const l of inv.lines) {
    const desc = PdfPage.wrap(l.description, 250, 9.5);
    const extra = l.periodStart ? 1 : 0;
    const h = (desc.length + extra) * 12 + 8;
    if (y + h > pg.height - 160) {
      pg = new PdfPage();
      pages.push(pg);
      y = 64;
      head();
    }
    desc.forEach((d, i) => pg.text(cols.desc, y + i * 12, d, { size: 9.5 }));
    if (l.periodStart) pg.text(cols.desc, y + desc.length * 12, `${day(l.periodStart)} – ${day(l.periodEnd)}`, { size: 8, gray: 0.45 });
    pg.text(cols.sac, y, l.sac || '—', { size: 9.5 });
    pg.text(cols.qty, y, String(l.quantity ?? 1), { size: 9.5, align: 'right' });
    pg.text(cols.rate, y, inr(l.unitPrice), { size: 9.5, align: 'right' });
    pg.text(cols.amount, y, inr(l.amount), { size: 9.5, align: 'right' });
    y += h;
    pg.line(L, y - 8, R, y - 8, 0.4, 0.85);
  }

  // Totals
  y += 8;
  const intra = inv.igst === 0 && (inv.cgst > 0 || inv.sgst > 0);
  const totals: [string, number][] = [
    ['Taxable value', inv.subtotal],
    ...(intra
      ? ([
          [`CGST ${inv.cgstRate || 9}%`, inv.cgst],
          [`SGST ${inv.sgstRate || 9}%`, inv.sgst],
        ] as [string, number][])
      : ([[`IGST ${inv.igstRate || 18}%`, inv.igst]] as [string, number][])),
  ];
  const TX = R - 220;
  for (const [k, v] of totals) {
    pg.text(TX, y, k, { size: 9.5, gray: 0.35 });
    pg.money(R, y, v, { size: 9.5, align: 'right' });
    y += 15;
  }
  pg.line(TX, y - 6, R, y - 6, 0.8, 0.3);
  y += 8;
  pg.text(TX, y, 'Total', { size: 12, bold: true });
  pg.money(R, y, inv.total, { size: 12, bold: true, align: 'right' });
  y += 24;
  pg.text(L, y, 'Amount in words:', { size: 9, gray: 0.4 });
  for (const line of PdfPage.wrap(inrInWords(inv.total), R - L - 90, 9.5, true)) {
    pg.text(L + 82, y, line, { size: 9.5, bold: true });
    y += 13;
  }
  y += 6;
  pg.text(L, y, `Status: ${paid ? 'Paid' : inv.status}`, { size: 9 });
  y += 24;
  pg.line(L, y, R, y);
  pg.text(L, y + 14, 'This is a computer-generated invoice and needs no signature.', { size: 8, gray: 0.45 });
  pages.forEach((p, i) => {
    if (pages.length > 1) p.text(R, p.height - 30, `Page ${i + 1} of ${pages.length}`, { size: 8, gray: 0.5, align: 'right' });
  });
  return renderPdf(pages, `Tax invoice ${inv.number}`);
}
