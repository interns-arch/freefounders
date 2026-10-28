/**
 * The GST invoice email (PLAN.md §24.5): subject, plain text and simple HTML (inline styles only; mail apps drop
 * <style>), with the PDF from invoice-pdf.ts attached by the caller. Sent through Resend (common/resend-mail.ts).
 */
import { inr } from '../common/pdf';
import { escapeHtml } from '../common/resend-mail';
import { day, type InvoiceForPdf } from './invoice-pdf';

/** "28 Oct 2026 – 28 Nov 2026", or the issue date when the invoice has no period. */
export function invoicePeriod(inv: Pick<InvoiceForPdf, 'periodStart' | 'periodEnd' | 'issuedAt'>): string {
  return inv.periodStart && inv.periodEnd ? `${day(inv.periodStart)} – ${day(inv.periodEnd)}` : day(inv.issuedAt);
}

/** The file name of the attached PDF (same as the download). */
export const invoiceFileName = (number: string) => `invoice-${number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;

/** Lower-cased, valid-looking, without repeats. */
export function recipients(list: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const e = raw?.trim().toLowerCase();
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

export function invoiceEmail(inv: InvoiceForPdf, opts: { webUrl?: string | null } = {}): { subject: string; html: string; text: string } {
  const period = invoicePeriod(inv);
  const subject = `Kaampilot invoice ${inv.number} for ${period}`;
  const total = inr(inv.total);
  const billing = opts.webUrl ? `${opts.webUrl.replace(/\/+$/, '')}/billing` : null;
  const text = [
    `Hello ${inv.buyer.name},`,
    '',
    `Thank you for your payment. Your GST tax invoice ${inv.number} from ${inv.seller.name} is attached as a PDF.`,
    '',
    `Invoice: ${inv.number}`,
    `Date: ${day(inv.issuedAt)}`,
    `Period: ${period}`,
    `Total (incl. GST): Rs. ${total}`,
    `Status: ${inv.status === 'paid' ? 'Paid' : inv.status}`,
    '',
    billing ? `You can also open and download it any time in Kaampilot → Billing → Invoices: ${billing}` : 'You can also open and download it any time in Kaampilot → Billing → Invoices.',
    '',
    'Kaampilot',
  ].join('\n');
  const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#475569">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(v)}</td></tr>`;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">' +
    '<p style="font-size:18px;font-weight:bold;margin:0 0 16px">Kaampilot</p>' +
    `<p style="margin:0 0 12px">Hello ${escapeHtml(inv.buyer.name)},</p>` +
    `<p style="margin:0 0 16px">Thank you for your payment. Your GST tax invoice from ${escapeHtml(inv.seller.name)} is attached as a PDF.</p>` +
    '<table style="border-collapse:collapse;margin:0 0 16px;font-size:14px">' +
    row('Invoice', inv.number) +
    row('Date', day(inv.issuedAt)) +
    row('Period', period) +
    row('Total (incl. GST)', `₹${total}`) +
    row('Status', inv.status === 'paid' ? 'Paid' : inv.status) +
    '</table>' +
    `<p style="margin:0;color:#475569;font-size:13px">You can also open and download it any time in Kaampilot → Billing → Invoices${billing ? `: <a href="${escapeHtml(billing)}" style="color:#4338ca">${escapeHtml(billing)}</a>` : '.'}</p></div>`;
  return { subject, html, text };
}
