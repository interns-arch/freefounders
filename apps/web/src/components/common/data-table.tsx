import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import type React from 'react';
import { isValidElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Checkbox, Skeleton } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useHotkeys } from '@/lib/hotkeys';
import { cn, formatNumber } from '@/lib/utils';
import { EmptyState, ErrorState } from './page';
import { useIsPhone } from './responsive';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  /** Hidden in the table under the `md` breakpoint (the phone card layout still shows it). */
  hideOnMobile?: boolean;
  /** Left out of the phone card layout too (e.g. a column that repeats the title). */
  hideInCard?: boolean;
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
  /** Under 640 px the rows become cards (default) — pass false to keep the table and scroll sideways. */
  cardsOnPhone?: boolean;
  className?: string;
}

/**
 * Server-driven table: sorting, selection, keyboard navigation, loading / empty / error states.
 * On phones every row is a card (first column as the title, the rest as label/value lines), so nothing is cut off.
 * Rows that open something are focusable and respond to Enter and Space.
 */
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
  cardsOnPhone = true,
  className,
}: DataTableProps<T>) {
  const [active, setActive] = useState(-1);
  const phone = useIsPhone() && cardsOnPhone;
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

  const rowKeyDown = (row: T) => (e: React.KeyboardEvent) => {
    if (!onRowClick || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  };

  if (phone) {
    const cardCols = columns.filter((c) => !c.hideInCard);
    const [title, ...rest] = cardCols;
    return (
      <div className={cn('relative', className)}>
        {fetching && !loading && <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-gradient-to-r from-brand-2 to-primary motion-reduce:animate-none" />}
        {selectable && list.length > 0 && !loading && (
          <label className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">
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
            {headerState === true ? 'All selected' : 'Select all on this page'}
          </label>
        )}
        {loading ? (
          <ul className="divide-y" aria-busy="true" aria-label="Loading">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="space-y-2 px-4 py-3.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y">
            {list.map((row) => {
              const id = rowKey(row);
              const isSelected = selected?.has(id) ?? false;
              return (
                <li
                  key={id}
                  data-state={isSelected ? 'selected' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={rowKeyDown(row)}
                  className={cn(
                    'flex gap-3 px-4 py-3.5 outline-none transition-colors data-[state=selected]:bg-primary/6',
                    onRowClick && 'cursor-pointer hover:bg-muted/40 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                  )}
                >
                  {selectable && (
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label="Select row" checked={isSelected} onCheckedChange={() => toggle(id)} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {title && <div className="text-[15px] font-semibold">{title.cell(row)}</div>}
                    {rest.length > 0 && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        {rest.map((c) => {
                          const value = c.cell(row);
                          if (value === null || value === undefined || value === '') return null;
                          // A column without a heading (row actions) runs across the whole card.
                          const bare = c.header === null || c.header === undefined || c.header === '' || (isValidElement(c.header) && String((c.header.props as { className?: string }).className ?? '').includes('sr-only'));
                          return (
                            <div key={c.key} className="contents">
                              {!bare && <dt className="text-[13px] font-medium text-muted-foreground">{c.header}</dt>}
                              <dd className={cn('min-w-0 break-words [&>div]:justify-start', bare && 'col-span-2 pt-1')}>{value}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && list.length === 0 && (empty ?? <EmptyState title="Nothing here yet" />)}
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {fetching && !loading && <div className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-gradient-to-r from-brand-2 to-primary motion-reduce:animate-none" />}
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
                <TH key={c.key} className={cn(c.headerClassName, c.hideOnMobile && 'hidden md:table-cell')} aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}>
                  {sortable ? (
                    <button
                      type="button"
                      className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 uppercase transition hover:bg-accent hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                      onClick={() => onSortChange!({ key: c.sortKey!, dir: isSorted && sort!.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      {c.header}
                      {isSorted ? sort!.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3 opacity-60" aria-hidden />}
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
                    className={cn(onRowClick && 'cursor-pointer', i === active && 'bg-accent/70 hover:bg-accent/70')}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={() => onRowClick?.(row)}
                    onKeyDown={rowKeyDown(row)}
                    onMouseEnter={() => onRowHover?.(row)}
                    onFocus={() => onRowHover?.(row)}
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
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5 text-sm text-foreground/80" aria-label="Pagination">
      <span className="font-mono text-xs tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <NativeSelect className="h-8 w-auto py-0 text-sm" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </NativeSelect>
        )}
        <span className="font-mono text-xs tabular">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
