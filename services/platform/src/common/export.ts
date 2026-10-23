/**
 * Downloads everywhere (PLAN.md §19.31): `?export=xlsx|csv` on the People, Roles and Invoices lists returns a file of
 * every matching row, built from the list's own query and permission checks. Typed text never becomes a live
 * formula (sheet.ts `safeCell`).
 */
import { StreamableFile } from '@nestjs/common';
import { deflateRawSync } from 'node:zlib';
import { type SheetCell, toCsv, toXlsx } from './sheet';

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_MAX = 50_000;

export function exportFormat(value: unknown): ExportFormat | null {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value) ? (value as ExportFormat) : null;
}

/** A Date for an ISO date/time string (dates as local midnight), else the value. */
export function when(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function exportFile(format: ExportFormat, name: string, header: string[], rows: SheetCell[][]): StreamableFile {
  const title = name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const data = { title, header, rows: rows.slice(0, EXPORT_MAX) };
  const bytes = Buffer.from(format === 'xlsx' ? toXlsx(data, (b) => deflateRawSync(b)) : toCsv(data));
  return new StreamableFile(bytes, {
    type: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${name}.${format}"`,
  });
}
