/** Downloads for Billing (PLAN.md §19.31); the owner console exports its loaded companies list in the screen. */
import type { ExportTarget } from '../export';

export const billingExports = {
  /** Every invoice of the company (GET /billing/invoices?export=xlsx|csv). */
  invoices: (): ExportTarget => ({ api: 'platform', path: '/billing/invoices' }),
  /** One GST tax invoice as a PDF. */
  invoicePdf: (id: string): ExportTarget => ({ api: 'platform', path: `/billing/invoices/${encodeURIComponent(id)}/pdf`, formats: ['pdf'], param: 'none' }),
  /** Owner console "Recent actions" (staff audit log, PLAN.md §21.7) with its company / action filters. */
  audit: (filters: { company?: string; action?: string }): ExportTarget => ({
    api: 'platform',
    path: '/console/audit',
    query: { company: filters.company || undefined, action: filters.action || undefined },
  }),
};
