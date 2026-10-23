/**
 * Downloads everywhere (PLAN.md §19.31). A list route marked `@Exportable(...)` answers `?export=xlsx|csv` (plus the
 * screen's usual filters, search and sort) with a file of ALL matching rows: `listParams` turns the page into
 * "first EXPORT_MAX rows", the route's own service code filters and checks permissions as for the screen, and this
 * interceptor turns the answer (`{ items }` or an array) into the file. Typed text never becomes a live formula
 * (sheet.ts `safeCell`).
 */
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, SetMetadata, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { deflateRawSync } from 'node:zlib';
import { map, type Observable } from 'rxjs';
import { type SheetCell, toCsv, toXlsx } from './sheet';

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_MAX = 50_000;
const EXPORT_KEY = 'eam:export';

type Row = Record<string, unknown>;
export type ExportColumn = [header: string, get: string | ((row: Row) => unknown)];
export interface ExportSpec {
  /** File and sheet name, e.g. "assets". */
  name: string;
  /** Columns (or columns worked out from the rows, e.g. per-type attributes); default: every plain field. */
  columns?: ExportColumn[] | ((rows: Row[]) => ExportColumn[]);
  /** Rows to write when the answer is not `{ items }` / an array (e.g. a detail with lines). */
  rows?: (data: unknown) => Row[];
}

/** Marks a GET route as downloadable with `?export=xlsx|csv`. */
export const Exportable = (spec: ExportSpec) => SetMetadata(EXPORT_KEY, spec);

/** "IN_STOCK" → "In stock" (for enum values without a label map). */
export function humanEnum(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "connection_number" / "connectionNumber" → "Connection number". */
export function humanKey(k: string): string {
  const s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function exportFormat(q: Record<string, unknown> | undefined): ExportFormat | null {
  const f = q?.export;
  return typeof f === 'string' && (EXPORT_FORMATS as readonly string[]).includes(f) ? (f as ExportFormat) : null;
}

const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?(0|[1-9]\d*)\.\d+$/;
const SKIP = /(^|[_A-Z])(url|urls|photo|photos|avatar|thumb|thumbnail|image|logo|token|secret|password|hash)s?$/i;
const NAME_KEYS = ['fullName', 'name', 'title', 'label', 'code', 'assetTag', 'email'];

function label(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
    const o = v as Row;
    for (const k of NAME_KEYS) if (o[k] !== null && o[k] !== undefined && o[k] !== '') return o[k];
    return '';
  }
  return v;
}

/** One value as a spreadsheet cell: names for nested objects, dates as dates, decimals as numbers. */
export function cell(v: unknown): SheetCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(label).filter((x) => x !== null && x !== undefined && x !== '').join(', ');
  if (typeof v === 'object') return cell(label(v));
  if (typeof v === 'string') {
    if (ISO_DT.test(v)) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : d;
    }
    if (ISO_D.test(v)) {
      const [y, m, d] = v.split('-').map(Number) as [number, number, number];
      return new Date(y, m - 1, d);
    }
    if (DECIMAL.test(v)) return Number(v);
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

function dig(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

const human = (k: string) => {
  const s = k.replace(/(.)(Id|Name)$/, '$1').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().toLowerCase();
  return s === 'id' || !s ? 'ID' : s.charAt(0).toUpperCase() + s.slice(1);
};

/** Columns for rows without a list of their own: plain fields; an `xId` next to an `x` object shows the object's name. */
export function autoColumns(sample: Row | undefined): ExportColumn[] {
  if (!sample) return [];
  const keys = Object.keys(sample);
  return keys
    .filter((k) => !SKIP.test(k) && !['customFields', 'attributes', 'meta', 'payload', 'data'].includes(k))
    // ids are not useful in a spreadsheet; their names (xName / x) are
    .filter((k) => k !== 'id' && k !== 'version' && !/Id$/.test(k))
    .map((k) => [human(k), k] as ExportColumn);
}

export function sheetRows(rows: Row[], columns: ExportColumn[]): { header: string[]; rows: SheetCell[][] } {
  return {
    header: columns.map(([h]) => h),
    rows: rows.map((r) => columns.map(([, get]) => cell(typeof get === 'function' ? get(r) : dig(r, get)))),
  };
}

export function exportBytes(format: ExportFormat, title: string, header: string[], rows: SheetCell[][]): Buffer {
  const data = { title, header, rows };
  return Buffer.from(format === 'xlsx' ? toXlsx(data, (b) => deflateRawSync(b)) : toCsv(data));
}

export function exportFile(format: ExportFormat, name: string, header: string[], rows: SheetCell[][]): StreamableFile {
  const title = name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return new StreamableFile(exportBytes(format, title, header, rows), {
    type: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${name}.${format}"`,
  });
}

@Injectable()
export class ExportInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ method: string; query: Record<string, unknown> }>();
    const format = req.method === 'GET' ? exportFormat(req.query) : null;
    const spec = format ? this.reflector.get<ExportSpec | undefined>(EXPORT_KEY, ctx.getHandler()) : undefined;
    if (!format || !spec) return next.handle();
    return next.handle().pipe(
      map((data: unknown) => {
        const items: Row[] = spec.rows
          ? spec.rows(data)
          : Array.isArray(data)
            ? (data as Row[])
            : Array.isArray((data as { items?: unknown })?.items)
              ? (data as { items: Row[] }).items
              : [];
        const list = items.slice(0, EXPORT_MAX);
        const columns = typeof spec.columns === 'function' ? spec.columns(list) : (spec.columns ?? autoColumns(list[0]));
        const { header, rows } = sheetRows(list, columns);
        return exportFile(format, spec.name, header, rows);
      }),
    );
  }
}
