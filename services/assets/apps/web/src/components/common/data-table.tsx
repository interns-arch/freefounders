import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useHotkeys } from '@/lib/hotkeys';
import { cn, formatNumber } from '@/lib/utils';
import { EmptyState, ErrorState } from './page';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  onRowHover?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' }) => void;
  empty?: ReactNode;
  /** j/k/x/Enter keyboard navigation (enable on one table per page). */
  keyboard?: boolean;
  className?: string;
}

/** Server-driven table: sorting, selection, keyboard navigation, loading / empty / error states. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  fetching,
  error,
  onRetry,
  onRowClick,
  onRowHover,
  selectable,
  selected,
  onSelectedChange,
  sort,
  onSortChange,
  empty,
  keyboard = false,
  className,
}: DataTableProps<T>) {
  const [active, setActive] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const list = rows ?? [];

  useEffect(() => setActive(-1), [rows]);
  useEffect(() => {
    if (active < 0) return;
    bodyRef.current?.querySelectorAll('tr')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const toggle = (id: string) => {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  useHotkeys(
    {
      j: () => setActive((i) => Math.min(list.length - 1, i + 1)),
      k: () => setActive((i) => Math.max(0, i - 1)),
      enter: () => {
        if (active < 0 || !list[active] || !onRowClick) return false;
        onRowClick(list[active]);
      },
      x: () => {
        if (active < 0 || !list[active] || !selectable) return false;
        toggle(rowKey(list[active]));
      },
    },
    [list, active, selected],
    { enabled: keyboard && list.length > 0 },
  );

  const allIds = list.map(rowKey);
  const selectedOnPage = allIds.filter((id) => selected?.has(id)).length;
  const headerState = selectedOnPage === 0 ? false : selectedOnPage === allIds.length ? true : 'indeterminate';

  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div className={cn('relative', className)}>
      {fetching && !loading && <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary/60" />}
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            {selectable && (
              <TH className="w-10 pr-0">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={headerState}
                  onCheckedChange={() => {
                    if (!onSelectedChange || !selected) return;
                    const next = new Set(selected);
                    if (headerState === true) allIds.forEach((id) => next.delete(id));
                    else allIds.forEach((id) => next.add(id));
                    onSelectedChange(next);
                  }}
                />
              </TH>
            )}
            {columns.map((c) => {
              const sortable = c.sortKey && onSortChange;
              const isSorted = sort && c.sortKey === sort.key;
              return (
                <TH key={c.key} className={cn(c.headerClassName, c.hideOnMobile && 'hidden md:table-cell')}>
                  {sortable ? (
                    <button
                      type="button"
                      className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                      onClick={() => onSortChange!({ key: c.sortKey!, dir: isSorted && sort!.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      {c.header}
                      {isSorted ? sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </TH>
              );
            })}
          </TR>
        </THead>
        <TBody ref={bodyRef}>
          {loading
            ? Array.from({ length: 8 }, (_, i) => (
                <TR key={i}>
                  {selectable && (
                    <TD>
                      <Skeleton className="size-4" />
                    </TD>
                  )}
                  {columns.map((c) => (
                    <TD key={c.key} className={cn(c.hideOnMobile && 'hidden md:table-cell')}>
                      <Skeleton className={cn('h-4', c.key === columns[0].key ? 'w-48' : 'w-20')} />
                    </TD>
                  ))}
                </TR>
              ))
            : list.map((row, i) => {
                const id = rowKey(row);
                const isSelected = selected?.has(id) ?? false;
                return (
                  <TR
                    key={id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={cn(onRowClick && 'cursor-pointer hover:bg-muted/50', i === active && 'bg-accent/70 hover:bg-accent/70')}
                    onClick={() => onRowClick?.(row)}
                    onMouseEnter={() => onRowHover?.(row)}
                  >
                    {selectable && (
                      <TD className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label="Select row" checked={isSelected} onCheckedChange={() => toggle(id)} />
                      </TD>
                    )}
                    {columns.map((c) => (
                      <TD key={c.key} className={cn(c.className, c.hideOnMobile && 'hidden md:table-cell')}>
                        {c.cell(row)}
                      </TD>
                    ))}
                  </TR>
                );
              })}
        </TBody>
      </Table>
      {!loading && list.length === 0 && (empty ?? <EmptyState title="Nothing here yet" />)}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  useHotkeys(
    {
      '[': () => page > 1 && onPageChange(page - 1),
      ']': () => page < pages && onPageChange(page + 1),
    },
    [page, pages],
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-[13px] text-muted-foreground">
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <NativeSelect className="h-8 w-auto py-0 text-[13px]" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </NativeSelect>
        )}
        <span className="tabular">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
