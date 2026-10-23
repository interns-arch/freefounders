/**
 * /billing/invoices/:id: a printable GST tax invoice (PLAN.md §20.6): seller and buyer with GSTIN, place of supply,
 * lines with SAC, CGST + SGST (same state) or IGST, total in words. Download PDF (made by the Platform, PLAN.md §19.31) or
 * print; in the phone app through the native bridge.
 */
import { billingExports, formatInr, inrInWords, type Invoice, type Party, useInvoice } from '@freefounders/core/billing';
import { fileSlug } from '@freefounders/core/export';
import { DownloadButton } from '@/components/common/download-menu';
import { ArrowLeft, Printer } from '@/components/icons';
import { Link, useParams } from 'react-router';
import { ErrorState, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { printPage } from '@/lib/native-bridge';
import { formatDate } from '@/lib/utils';

export function InvoicePage() {
  const { id } = useParams();
  const q = useInvoice(id);
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-6 print:bg-transparent print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/billing">
            <ArrowLeft /> Billing
          </Link>
        </Button>
        {q.data && (
          <div className="flex flex-wrap items-center gap-2">
            <DownloadButton size="default" filename={fileSlug('invoice', q.data.number)} target={billingExports.invoicePdf(q.data.id)} />
            <Button onClick={() => void printPage()}>
              <Printer /> Print
            </Button>
          </div>
        )}
      </div>
      <main id="content" className="mx-auto max-w-[820px]">
        {q.isLoading ? <PageLoader /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <InvoiceSheet inv={q.data} />}
      </main>
    </div>
  );
}

function PartyBlock({ title, p }: { title: string; p: Party }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</p>
      <p className="mt-1 font-semibold">{p.legalName || p.name || '—'}</p>
      {p.address && <p className="text-sm whitespace-pre-line">{p.address}</p>}
      {p.state && (
        <p className="text-sm">
          State: {p.state}
          {p.stateCode ? ` (code ${p.stateCode})` : ''}
        </p>
      )}
      <p className="text-sm">GSTIN: {p.gstin ? <span className="font-mono">{p.gstin}</span> : 'Unregistered'}</p>
      {p.email && <p className="text-sm">{p.email}</p>}
    </div>
  );
}

function InvoiceSheet({ inv }: { inv: Invoice }) {
  const intra = (inv.igst ?? 0) === 0 && ((inv.cgst ?? 0) > 0 || (inv.sgst ?? 0) > 0);
  const sacOf = (l: Invoice['lines'][number]) => l.sac ?? l.hsn ?? inv.sac ?? inv.hsnSac ?? '—';
  const date = inv.date ?? inv.issuedAt;
  return (
    <article className="rounded-xl border bg-card p-5 text-card-foreground shadow-card sm:p-8 print:rounded-none print:border-0 print:shadow-none" aria-labelledby="invoice-title">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 id="invoice-title" className="text-2xl font-bold tracking-tight">
            Tax invoice
          </h1>
          <p className="text-sm text-muted-foreground">{inv.reverseCharge ? 'Reverse charge: yes' : 'Reverse charge: no'}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 text-sm">
          <dt className="text-muted-foreground">Invoice no.</dt>
          <dd className="font-mono font-semibold">{inv.number}</dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDate(date)}</dd>
          {inv.periodStart && (
            <>
              <dt className="text-muted-foreground">Period</dt>
              <dd>
                {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Place of supply</dt>
          <dd>{inv.placeOfSupply ?? inv.buyer.state ?? '—'}</dd>
        </dl>
      </header>

      <div className="grid gap-5 border-b py-4 sm:grid-cols-2">
        <PartyBlock title="Seller" p={inv.seller} />
        <PartyBlock title="Bill to" p={inv.buyer} />
      </div>

      <div className="overflow-x-auto py-4">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b text-left font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
              <th className="py-2 pr-2 font-semibold">Description</th>
              <th className="py-2 pr-2 font-semibold">SAC</th>
              <th className="py-2 pr-2 text-right font-semibold">Qty</th>
              <th className="py-2 pr-2 text-right font-semibold">Rate</th>
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-2 pr-2">
                  {l.description}
                  {l.periodStart && (
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(l.periodStart)} – {formatDate(l.periodEnd)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2 font-mono">{sacOf(l)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{l.quantity ?? 1}</td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums">{l.unitPrice != null ? formatInr(l.unitPrice, true) : '—'}</td>
                <td className="py-2 text-right font-mono tabular-nums">{formatInr(l.amount, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <Row label="Taxable value" value={inv.subtotal} />
          {intra ? (
            <>
              <Row label={`CGST ${inv.cgstRate ?? 9}%`} value={inv.cgst} />
              <Row label={`SGST ${inv.sgstRate ?? 9}%`} value={inv.sgst} />
            </>
          ) : (
            <Row label={`IGST ${inv.igstRate ?? 18}%`} value={inv.igst} />
          )}
          <div className="flex justify-between gap-3 border-t pt-1.5 text-base font-bold">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums">{formatInr(inv.total, true)}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">Amount in words: </span>
        <span className="font-medium">{inv.totalInWords || inrInWords(inv.total)}</span>
      </p>
      {inv.notes && <p className="mt-3 text-sm text-muted-foreground">{inv.notes}</p>}
      <p className="mt-6 border-t pt-3 text-xs text-muted-foreground">This is a computer-generated invoice and needs no signature.</p>
    </article>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{formatInr(value ?? 0, true)}</dd>
    </div>
  );
}
