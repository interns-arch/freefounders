/**
 * Downloads everywhere (PLAN.md §19.31). A screen describes WHAT to download with an `ExportTarget` made by its area
 * (e.g. `assetsExports.assets(filters)` in @freefounders/core/assets): the API, the list path and the screen's own
 * filters. The API then answers `?export=xlsx|csv` with every matching row (≤ 50 000), filtered, sorted and
 * permission-checked by the same code as the list itself. Client-side files (`toXlsx`/`toCsv`) are only for screens
 * that already hold all their rows.
 */
import { useMutation } from '@tanstack/react-query';
import { assetsApi, platformApi, tasksApi, type Query } from '../http';

export { safeCell, toCsv, toXlsx, zip, type SheetCell, type SheetData } from './sheet';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf' | 'zip';
export type ExportApi = 'tasks' | 'assets' | 'platform';

export interface ExportTarget {
  api: ExportApi;
  /** List path (as the list hook uses it). */
  path: string;
  /** The screen's filters, search, sort, tab and date range; page/size are dropped. */
  query?: Query;
  /** Formats the API offers for this target (default xlsx + csv). */
  formats?: ExportFormat[];
  /**
   * How the format reaches the API: `export` (default: `?export=xlsx`), `format` (`?format=xlsx`, the attendance
   * reports) or `none` (one fixed format, e.g. a PDF endpoint).
   */
  param?: 'export' | 'format' | 'none';
}

const APIS = { tasks: tasksApi, assets: assetsApi, platform: platformApi } as const;
const PAGING = new Set(['page', 'page_size', 'pageSize', 'limit', 'offset', 'cursor']);

export function exportQuery(target: ExportTarget, format: ExportFormat): Query {
  const q: Query = {};
  for (const [k, v] of Object.entries(target.query ?? {})) if (!PAGING.has(k)) q[k] = v;
  const param = target.param ?? 'export';
  if (param !== 'none') q[param] = format;
  return q;
}

/** Fetches the file for a target (the token rides along, so not a plain link). */
export function fetchExport(target: ExportTarget, format: ExportFormat): Promise<Blob> {
  return APIS[target.api].blob(target.path, exportQuery(target, format));
}

/** The download as a mutation: `mutateAsync({ target, format })` → Blob. */
export function useExportFile() {
  return useMutation({ mutationFn: ({ target, format }: { target: ExportTarget; format: ExportFormat }) => fetchExport(target, format) });
}

/** A file-name part from free text: lower case, a-z 0-9 and dashes. */
export function fileSlug(...parts: Array<string | number | null | undefined | false>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== false && String(p).trim() !== '')
    .map((p) => String(p).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
    .slice(0, 120);
}

/** Today as YYYY-MM-DD (local). */
export function todayStamp(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
