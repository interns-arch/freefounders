/**
 * The one Download control (PLAN.md §19.31): in a page header's actions, icon + "Download", a menu of the formats on
 * offer (Excel / CSV / PDF / ZIP). The file always has every row matching the screen's current filters, search,
 * sort, date range and tab, not just the visible page:
 *   - `target`: the API builds the file with the list's own query and permission checks (preferred);
 *   - `rows`: the screen already holds ALL its rows, the file is made here.
 * Disabled with a tooltip when there is nothing to export. Downloads still work in a read-only company. In the phone
 * app the file goes through the native bridge (saveFile).
 */
import { errorMessage } from '@kaampilot/core';
import { fetchExport, toCsv, toXlsx, type ExportFormat, type ExportTarget, type SheetData } from '@kaampilot/core/export';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Download, FileCsv, FilePdf, FileSpreadsheet, FileZip } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/overlays';
import { saveFile } from '@/lib/native-bridge';
import { cn } from '@/lib/utils';

const LABEL: Record<ExportFormat, string> = { xlsx: 'Excel (.xlsx)', csv: 'CSV', pdf: 'PDF', zip: 'ZIP of PDFs' };
const ICON = { xlsx: FileSpreadsheet, csv: FileCsv, pdf: FilePdf, zip: FileZip } as const;

/** One extra entry in the menu (e.g. "All payslips (one PDF)"). */
export interface DownloadExtra {
  label: string;
  format: ExportFormat;
  filename: string;
  target: ExportTarget;
}

export interface DownloadMenuProps {
  /** File name without extension: `<area>-<screen>-<filters/date>`. */
  filename: string;
  /** Server-side file (preferred). */
  target?: ExportTarget;
  /** Client-side file from rows the screen already holds in full. */
  rows?: () => SheetData;
  /** Formats on offer (default Excel + CSV). */
  formats?: ExportFormat[];
  /** More entries, e.g. combined PDFs. */
  extra?: DownloadExtra[];
  /** Nothing matches the filters: the button is disabled with a tooltip. */
  empty?: boolean;
  /** Still loading: disabled without the "nothing" tooltip. */
  loading?: boolean;
  label?: ReactNode;
  /** Accessible name when several menus share a screen (e.g. "Download September 2026"). */
  ariaLabel?: string;
  size?: 'default' | 'sm' | 'xs';
  className?: string;
}

async function save(name: string, blob: Blob) {
  await saveFile(name, blob);
}

export function DownloadMenu({ filename, target, rows, formats, extra = [], empty, loading, label = 'Download', ariaLabel, size = 'sm', className }: DownloadMenuProps) {
  const [busy, setBusy] = useState(false);
  const list: ExportFormat[] = formats ?? target?.formats ?? ['xlsx', 'csv'];

  async function run(format: ExportFormat, name: string, t?: ExportTarget) {
    setBusy(true);
    try {
      let blob: Blob;
      if (t) blob = await fetchExport(t, format);
      else if (rows && (format === 'xlsx' || format === 'csv')) {
        const data = rows();
        blob =
          format === 'xlsx'
            ? new Blob([toXlsx(data) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
            : new Blob([toCsv(data) as BlobPart], { type: 'text/csv;charset=utf-8' });
      } else throw new Error('This format is not available here.');
      await save(`${name}.${format}`, blob);
    } catch (err) {
      toast.error(`Download failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const disabled = !!empty || !!loading || busy;
  const tip = empty ? 'Nothing to download for these filters' : `Download ${list.map((f) => LABEL[f].replace(/ \(.*\)/, '')).join(' / ')}`;

  return (
    // the span carries the tooltip: a disabled button gets no hover events
    <span title={tip} className={cn('inline-flex', className)} data-testid="download-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="outline" size={size} disabled={disabled} loading={busy} aria-label={`${ariaLabel ?? 'Download'}${empty ? ' (nothing to download)' : ''}`}>
            {!busy && <Download />}
            {label}
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Download as</DropdownMenuLabel>
          {list.map((f) => {
            const I = ICON[f];
            return (
              <DropdownMenuItem key={f} onSelect={() => void run(f, filename, target)}>
                <I /> {LABEL[f]}
              </DropdownMenuItem>
            );
          })}
          {extra.map((x) => {
            const I = ICON[x.format];
            return (
              <DropdownMenuItem key={x.label} onSelect={() => void run(x.format, x.filename, x.target)}>
                <I /> {x.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** A single-file download button (e.g. one payslip's PDF). */
export function DownloadButton({
  filename,
  target,
  format = 'pdf',
  children = 'Download PDF',
  size = 'xs',
  variant = 'outline',
  className,
  'aria-label': ariaLabel,
}: {
  filename: string;
  target: ExportTarget;
  format?: ExportFormat;
  children?: ReactNode;
  size?: 'default' | 'sm' | 'xs';
  variant?: 'outline' | 'ghost' | 'secondary';
  className?: string;
  'aria-label'?: string;
}) {
  const [busy, setBusy] = useState(false);
  const I = ICON[format];
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      loading={busy}
      aria-label={ariaLabel}
      onClick={async () => {
        setBusy(true);
        try {
          await save(`${filename}.${format}`, await fetchExport(target, format));
        } catch (err) {
          toast.error(`Download failed: ${errorMessage(err)}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!busy && <I />}
      {children}
    </Button>
  );
}
