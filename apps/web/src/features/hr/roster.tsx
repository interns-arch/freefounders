/**
 * Attendance → Roster (PLAN.md §28.4): people (rows) × days (columns) for a week or a month. Click a cell to select it
 * and pick a shift in the bar above the grid; drag, Shift-click or Ctrl-click to select many. Bulk: Apply to week, Copy
 * last week, Repeat pattern, Default shift. Changes stay unsaved until Save (Undo / Discard); rest-time warnings never
 * block. Phones: the grid scrolls inside its card with the names sticky, or "By day" lists one day. Excel export and
 * import of the same file.
 */
import { errorMessage } from '@kaampilot/core';
import {
  type Roster,
  type RosterChange,
  type RosterPerson,
  type Shift,
  useDownloadRoster,
  useFetchRoster,
  useImportRoster,
  useRoster,
  useSaveRoster,
  type RosterImportResult,
} from '@kaampilot/core/hr';
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Copy, Download, Repeat, Save, Undo2, Upload, UserRound, X } from '@/components/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/common/page';
import { Segmented } from '@/components/common/controls';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { ErrorNote, OkNote, todayLocal } from '../tasks/general/parts';
import { downloadBlob } from '../tasks/shared/csv';
import { ShiftCode, shiftHours, toneOf } from './shift-parts';

type View = 'week' | 'month';
type Layout = 'grid' | 'day';
type Key = string; // `${user}|${date}`

const key = (user: number, date: string): Key => `${user}|${date}`;
const parseKey = (k: Key) => {
  const [u, d] = k.split('|');
  return { user: Number(u), date: d };
};

function iso(d: Date) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
function addDays(s: string, n: number) {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
}
function mondayOf(s: string) {
  const d = new Date(`${s}T12:00:00`);
  return addDays(s, -((d.getDay() + 6) % 7));
}
function monthRange(s: string) {
  const d = new Date(`${s}T12:00:00`);
  const first = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
  return [iso(first), iso(last)] as const;
}
const dayNum = (s: string) => Number(s.slice(8, 10));
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function RosterTab() {
  const [view, setView] = useState<View>('week');
  const [layout, setLayout] = useState<Layout>('grid');
  const [anchor, setAnchor] = useState(() => mondayOf(todayLocal()));
  const [department, setDepartment] = useState('');
  const [manager, setManager] = useState<number | ''>('');
  const [q, setQ] = useState('');
  const [from, to] = view === 'week' ? [anchor, addDays(anchor, 6)] : monthRange(anchor);
  const query = useRoster({ from, to, department, manager, q });
  const data = query.data;
  const loadingRange = query.isPlaceholderData || (!!data && (data.from !== from || data.to !== to));

  // Unsaved work: cell changes (null = clear the day) and default shifts, with an undo history.
  const [pending, setPending] = useState<Map<Key, number | null>>(new Map());
  const [pendingDefaults, setPendingDefaults] = useState<Map<number, number | null>>(new Map());
  const [history, setHistory] = useState<Array<[Map<Key, number | null>, Map<number, number | null>]>>([]);
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [dialog, setDialog] = useState<'pattern' | 'default' | 'import' | null>(null);
  const save = useSaveRoster();
  const fetchRoster = useFetchRoster();
  const download = useDownloadRoster();
  const dirty = pending.size + pendingDefaults.size;
  // A selection belongs to the range it was made in.
  useEffect(() => setSelected(new Set()), [data?.from, data?.to]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const shiftById = useMemo(() => new Map((data?.shifts ?? []).map((s) => [s.id, s])), [data?.shifts]);
  const active = useMemo(() => (data?.shifts ?? []).filter((s) => s.active), [data?.shifts]);
  const saved = useMemo(() => new Map((data?.entries ?? []).map((e) => [key(e.user, e.date), e.shift])), [data?.entries]);
  const leaves = useMemo(() => new Map((data?.leaves ?? []).map((l) => [key(l.user, l.date), l])), [data?.leaves]);

  const cellShift = (k: Key): number | null => (pending.has(k) ? (pending.get(k) ?? null) : (saved.get(k) ?? null));
  const defaultOf = (p: RosterPerson): number | null => (pendingDefaults.has(p.user_id) ? (pendingDefaults.get(p.user_id) ?? null) : p.default_shift);
  const editable = (p: RosterPerson) => !p.is_self || !!data?.can_edit_self;
  const lockedCell = (k: Key) => {
    const l = leaves.get(k);
    return !!l && l.status === 'approved' && !l.half_day;
  };

  const remember = () => setHistory((h) => [...h.slice(-49), [new Map(pending), new Map(pendingDefaults)]]);
  const setCells = (changes: Array<[Key, number | null]>) => {
    if (!changes.length) return;
    remember();
    setPending((prev) => {
      const next = new Map(prev);
      for (const [k, v] of changes) {
        const was = saved.get(k) ?? null;
        if (v === was) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });
    setMsg('');
  };
  const assign = (shift: number | null) => setCells([...selected].filter((k) => !lockedCell(k)).map((k) => [k, shift] as [Key, number | null]));
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    setPending(last[0]);
    setPendingDefaults(last[1]);
    setHistory((h) => h.slice(0, -1));
  };
  const discard = () => {
    setPending(new Map());
    setPendingDefaults(new Map());
    setHistory([]);
    setSelected(new Set());
  };
  const move = (dir: number) => {
    if (dirty && !window.confirm('You have unsaved changes on this roster. Leave them?')) return;
    discard();
    setAnchor(view === 'week' ? addDays(anchor, 7 * dir) : (() => {
      const d = new Date(`${anchor}T12:00:00`);
      return iso(new Date(d.getFullYear(), d.getMonth() + dir, 1, 12));
    })());
  };
  const changeView = (v: View) => {
    if (dirty && !window.confirm('You have unsaved changes on this roster. Leave them?')) return;
    discard();
    setView(v);
    setAnchor(v === 'week' ? mondayOf(anchor) : monthRange(anchor)[0]);
  };

  const submit = () => {
    setErr('');
    const changes: RosterChange[] = [...pending].map(([k, shift]) => ({ ...parseKey(k), shift }));
    const defaults = [...pendingDefaults].map(([user, shift]) => ({ user, shift }));
    save.mutate(
      { changes, defaults },
      {
        onSuccess: (r) => {
          discard();
          setMsg(`Saved ${r.saved} day${r.saved === 1 ? '' : 's'}${r.defaults ? ` and ${r.defaults} default shift${r.defaults === 1 ? '' : 's'}` : ''}.${r.notified ? ` ${r.notified} ${r.notified === 1 ? 'person was' : 'people were'} told.` : ''}`);
        },
        onError: (e) => setErr(errorMessage(e)),
      },
    );
  };

  // ---- bulk actions
  const people = data?.people ?? [];
  const days = data?.days ?? [];
  const selectedUsers = () => {
    const ids = new Set([...selected].map((k) => parseKey(k).user));
    return people.filter((p) => ids.has(p.user_id) && editable(p));
  };
  const usersOrAll = () => {
    const s = selectedUsers();
    return s.length ? s : people.filter(editable);
  };
  const applyToWeek = () => {
    const changes: Array<[Key, number | null]> = [];
    const byUser = new Map<number, string>();
    for (const k of [...selected].sort()) {
      const { user, date } = parseKey(k);
      if (!byUser.has(user)) byUser.set(user, date);
    }
    for (const [user, date] of byUser) {
      const value = cellShift(key(user, date));
      const monday = mondayOf(date);
      for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i);
        const info = days.find((x) => x.date === d);
        if (!info || info.week_off || info.holiday || d === date) continue;
        const k = key(user, d);
        if (!lockedCell(k)) changes.push([k, value]);
      }
    }
    setCells(changes);
  };
  const copyLastWeek = () => {
    setErr('');
    fetchRoster.mutate(
      { from: addDays(from, -7), to: addDays(from, -1), department, manager, q },
      {
        onSuccess: (last: Roster) => {
          const prev = new Map(last.entries.map((e) => [key(e.user, e.date), e.shift]));
          const changes: Array<[Key, number | null]> = [];
          for (const p of usersOrAll()) {
            for (let i = 0; i < 7 && i < days.length; i++) {
              const d = days[i].date;
              const k = key(p.user_id, d);
              if (lockedCell(k)) continue;
              const v = prev.get(key(p.user_id, addDays(d, -7))) ?? null;
              if (v !== cellShift(k)) changes.push([k, v]);
            }
          }
          setCells(changes);
          setMsg(changes.length ? `Copied last week: ${changes.length} day${changes.length === 1 ? '' : 's'} changed (not saved yet).` : 'Last week is the same as this week.');
        },
        onError: (e) => setErr(errorMessage(e)),
      },
    );
  };

  // ---- warnings (rest between two shifts), worked out from what is on screen, unsaved changes included
  const warnings = useMemo(() => {
    const out = new Map<Key, string>();
    if (!data || !data.min_rest_hours) return out;
    const hours = (p: RosterPerson, d: string): { start: number; end: number; roster: boolean } | null => {
      const k = key(p.user_id, d);
      const sid = cellShift(k);
      const info = days.find((x) => x.date === d);
      let s: Shift | undefined;
      if (sid != null) s = shiftById.get(sid);
      else {
        if (info?.week_off) return null;
        const def = defaultOf(p);
        s = def != null ? shiftById.get(def) : undefined;
        if (!s) return { start: minutes(data.office.start), end: minutes(data.office.end), roster: false };
      }
      if (!s || s.is_off || !s.start || !s.end) return null;
      const st = minutes(s.start);
      let en = minutes(s.end);
      if (en <= st) en += 1440;
      return { start: st, end: en, roster: sid != null };
    };
    for (const p of people) {
      for (let i = 1; i < days.length; i++) {
        const a = hours(p, days[i - 1].date);
        const b = hours(p, days[i].date);
        if (!a || !b || !(a.roster || b.roster)) continue;
        const rest = (b.start + 1440 - a.end) / 60;
        if (rest < data.min_rest_hours) out.set(key(p.user_id, days[i].date), `Only ${Math.max(rest, 0).toFixed(1)} h rest before this shift (less than ${data.min_rest_hours} h).`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pending, pendingDefaults, shiftById]);

  // ---- selection with the mouse: click, drag, Shift-click (range), Ctrl / ⌘-click (add)
  const anchorCell = useRef<{ row: number; col: number } | null>(null);
  const dragging = useRef(false);
  const editableRows = people.map(editable);
  const rect = (a: { row: number; col: number }, b: { row: number; col: number }) => {
    const out = new Set<Key>();
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      if (!editableRows[r]) continue;
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
        const k = key(people[r].user_id, days[c].date);
        if (!lockedCell(k)) out.add(k);
      }
    }
    return out;
  };
  const down = (row: number, col: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const k = key(people[row].user_id, days[col].date);
    if (e.shiftKey && anchorCell.current) {
      setSelected(rect(anchorCell.current, { row, col }));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
      });
      anchorCell.current = { row, col };
      return;
    }
    anchorCell.current = { row, col };
    dragging.current = true;
    setSelected(new Set([k]));
  };
  const enter = (row: number, col: number) => {
    if (dragging.current && anchorCell.current) setSelected(rect(anchorCell.current, { row, col }));
  };
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  const keySelect = (row: number, col: number, e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setSelected(new Set());
  };

  if (query.error && !data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const title =
    view === 'week'
      ? `${new Date(`${from}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(`${to}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : new Date(`${from}T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const today = todayLocal();

  return (
    <div className="space-y-3">
      {/* Range, view and filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => move(-1)}>
            <ChevronLeft />
          </Button>
          <span className="min-w-40 text-center text-sm font-semibold" aria-live="polite">
            {title}
          </span>
          <Button variant="outline" size="icon" aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => move(1)}>
            <ChevronRight />
          </Button>
        </div>
        <Segmented label="Roster range" value={view} onChange={changeView} options={[['week', 'Week'], ['month', 'Month']]} />
        <Segmented label="Roster layout" value={layout} onChange={setLayout} options={[['grid', 'Grid'], ['day', 'By day']]} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={download.isPending}
            onClick={() => download.mutate({ from, to, department, manager, q, format: 'xlsx' }, { onSuccess: ({ filename, blob }) => downloadBlob(filename, blob), onError: (e) => setErr(errorMessage(e)) })}
          >
            <Download /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog('import')}>
            <Upload /> Import
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchField label="Search people" placeholder="Search name or employee ID" className="w-full sm:w-64" value={q} onChange={setQ} />
        <NativeSelect aria-label="Department" className="sm:w-48" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {data?.departments.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Manager" className="sm:w-48" value={String(manager)} onChange={(e) => setManager(e.target.value ? Number(e.target.value) : '')}>
          <option value="">All managers</option>
          {data?.managers.map((m) => (
            <option key={m.id} value={m.id}>
              Reports to {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* The shift picker for the selected cells, and the bulk actions */}
      {/* Phones: the bar floats above the bottom menu only while days are selected or changes are unsaved. */}
      <Card className={cn('sticky top-0 z-20 space-y-2 p-3', (selected.size > 0 || dirty > 0) && 'max-sm:fixed max-sm:inset-x-2 max-sm:top-auto max-sm:bottom-[4.75rem] max-sm:shadow-lg')}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium" aria-live="polite">
            {selected.size ? `${selected.size} day${selected.size === 1 ? '' : 's'} selected` : (
              <>
                <span className="sm:hidden">Tap days to plan them</span>
                <span className="max-sm:hidden">Select days in the grid (drag, Shift-click or Ctrl-click for many)</span>
              </>
            )}
          </span>
          {selected.size > 0 && (
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
              <X /> Clear selection
            </Button>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Set the selected days to">
            {active.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => assign(s.id)}
                title={s.label}
                className={cn('inline-flex h-9 min-w-11 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold transition hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none', toneOf(s.colour))}
              >
                <span className="font-mono">{s.code}</span>
                <span className="font-normal max-sm:hidden">{s.is_off ? 'Off' : shiftHours(s.start, s.end)}</span>
              </button>
            ))}
            <Button size="sm" variant="outline" onClick={() => assign(null)} title="Back to the default shift / office hours">
              Default
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
          <Button size="sm" variant="outline" disabled={!selected.size} onClick={applyToWeek} title="Copy each person's first selected day to the rest of that week (week-offs and holidays left alone)">
            <CalendarClock /> Apply to week
          </Button>
          <Button size="sm" variant="outline" disabled={view !== 'week'} loading={fetchRoster.isPending} onClick={copyLastWeek} title={view === 'week' ? 'Copy last week to this week (selected people, or everyone shown)' : 'Switch to the week view'}>
            <Copy /> Copy last week
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('pattern')}>
            <Repeat /> Repeat pattern
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('default')}>
            <UserRound /> Default shift
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {dirty > 0 && <span className="text-xs font-semibold text-warning">{dirty} unsaved</span>}
            <Button size="sm" variant="ghost" disabled={!history.length} onClick={undo}>
              <Undo2 /> Undo
            </Button>
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={discard}>
              Discard
            </Button>
            <Button size="sm" variant="cta" disabled={!dirty} loading={save.isPending} onClick={submit}>
              <Save /> Save
            </Button>
          </div>
        </div>
      </Card>
      <ErrorNote>{err}</ErrorNote>
      <OkNote>{msg}</OkNote>
      {warnings.size > 0 && (
        <p role="note" className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          {warnings.size} day{warnings.size === 1 ? '' : 's'} with less than {data?.min_rest_hours} h rest after the previous shift (a warning; you can still save).
        </p>
      )}

      {!data ? (
        <Skeleton className="h-96" />
      ) : people.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nobody to plan" description="No one in your scope matches these filters." />
      ) : layout === 'grid' ? (
        <Card className="overflow-hidden p-0 max-sm:mb-40">
          {/* While another week / month loads, the old one stays visible but cannot be selected. */}
          <div className={cn('max-h-[70vh] overflow-auto', loadingRange && 'pointer-events-none opacity-60')} role="grid" aria-label="Roster" aria-multiselectable="true" aria-busy={loadingRange}>
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm select-none">
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 left-0 z-20 min-w-44 border-r border-b bg-card px-3 py-2 text-left text-xs font-semibold text-muted-foreground max-sm:min-w-32">
                    Person
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.date}
                      scope="col"
                      className={cn('sticky top-0 z-10 min-w-12 border-b bg-card px-1 py-1.5 text-center text-xs font-medium', d.date === today && 'text-primary', (d.week_off || d.holiday) && 'bg-muted')}
                      title={d.holiday ?? (d.week_off ? 'Company week-off' : undefined)}
                    >
                      <div className="text-muted-foreground">{d.weekday}</div>
                      <div className={cn('font-mono font-semibold', d.date === today && 'text-primary')}>{dayNum(d.date)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p, row) => {
                  const def = defaultOf(p);
                  const defShift = def != null ? shiftById.get(def) : undefined;
                  const canEdit = editable(p);
                  return (
                    <tr key={p.user_id}>
                      <th scope="row" className="sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 text-left font-normal">
                        <div className="max-w-44 truncate text-sm font-medium max-sm:max-w-28">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground max-sm:hidden">
                          {defShift ? `Default ${defShift.code}` : 'Office hours'}
                          {pendingDefaults.has(p.user_id) && ' •'}
                          {!canEdit && ' · your own (read-only)'}
                        </div>
                      </th>
                      {days.map((d, col) => {
                        const k = key(p.user_id, d.date);
                        const sid = cellShift(k);
                        const s = sid != null ? shiftById.get(sid) : undefined;
                        const leave = leaves.get(k);
                        const locked = lockedCell(k);
                        const isSel = selected.has(k);
                        const changed = pending.has(k);
                        const warn = warnings.get(k);
                        const offByCompany = sid == null && d.week_off;
                        const label = locked
                          ? `${p.name}, ${d.weekday} ${dayNum(d.date)}: on ${leave?.type} leave`
                          : `${p.name}, ${d.weekday} ${dayNum(d.date)}: ${s ? s.label : offByCompany ? 'week-off' : defShift ? `default ${defShift.label}` : 'office hours'}${changed ? ' (unsaved)' : ''}${warn ? `. ${warn}` : ''}`;
                        return (
                          <td key={d.date} className={cn('border-b p-0.5', (d.week_off || d.holiday) && 'bg-muted/50')}>
                            <button
                              type="button"
                              role="gridcell"
                              aria-selected={isSel}
                              aria-label={label}
                              title={label}
                              disabled={!canEdit || locked}
                              onPointerDown={(e) => canEdit && !locked && down(row, col, e)}
                              onPointerEnter={() => canEdit && enter(row, col)}
                              onKeyDown={(e) => keySelect(row, col, e)}
                              onClick={(e) => {
                                // Keyboard: Enter / Space select the cell (the pointer handles mouse clicks).
                                if (e.detail === 0 && canEdit && !locked) setSelected(new Set([k]));
                              }}
                              className={cn(
                                'relative flex h-10 w-full min-w-11 cursor-pointer items-center justify-center rounded-sm border font-mono text-xs font-bold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed',
                                locked
                                  ? 'border-info/30 bg-info/10 text-info'
                                  : s
                                    ? toneOf(s.colour)
                                    : 'border-dashed border-border text-muted-foreground',
                                isSel && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
                                changed && 'border-2 border-foreground/50',
                              )}
                            >
                              {locked ? 'L' : s ? s.code : offByCompany ? 'WO' : defShift ? <span className="font-normal opacity-70">{defShift.code}</span> : '·'}
                              {leave && !locked && <span className="absolute top-0 right-0.5 text-[9px] font-normal text-info">L?</span>}
                              {warn && <AlertTriangle className="absolute right-0.5 bottom-0.5 size-3 text-warning" aria-hidden />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Legend shifts={active} />
        </Card>
      ) : (
        <ByDay data={data} cellShift={cellShift} defaultOf={defaultOf} selected={selected} setSelected={setSelected} lockedCell={lockedCell} editable={editable} shiftById={shiftById} />
      )}

      <PatternDialog
        open={dialog === 'pattern'}
        onClose={() => setDialog(null)}
        shifts={active}
        people={usersOrAll()}
        selectedOnly={selectedUsers().length > 0}
        apply={(seq, unit, stagger) => {
          const changes: Array<[Key, number | null]> = [];
          usersOrAll().forEach((p, i) => {
            days.forEach((d, col) => {
              const k = key(p.user_id, d.date);
              if (lockedCell(k) || d.holiday) return;
              const step = unit === 'week' ? Math.floor((col + ((new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7)) / 7) : col;
              const shift = seq[(step + (stagger ? i : 0)) % seq.length];
              const s = shiftById.get(shift);
              if (d.week_off && s && !s.is_off && unit === 'week') return; // weekly rotation keeps the week-off
              changes.push([k, shift]);
            });
          });
          setCells(changes);
          setDialog(null);
        }}
      />
      <DefaultDialog
        open={dialog === 'default'}
        onClose={() => setDialog(null)}
        shifts={active.filter((s) => !s.is_off)}
        people={usersOrAll()}
        selectedOnly={selectedUsers().length > 0}
        current={(p) => defaultOf(p)}
        apply={(users, shift) => {
          remember();
          setPendingDefaults((prev) => {
            const next = new Map(prev);
            for (const p of users) {
              if (shift === p.default_shift) next.delete(p.user_id);
              else next.set(p.user_id, shift);
            }
            return next;
          });
          setDialog(null);
        }}
      />
      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} />
    </div>
  );
}

function Legend({ shifts }: { shifts: Shift[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
      {shifts.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5">
          <ShiftCode code={s.code} colour={s.colour} /> {s.is_off ? 'Off' : `${s.name} ${shiftHours(s.start, s.end)}`}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex min-w-8 justify-center rounded-sm border border-dashed px-1.5 py-0.5 font-mono">G</span> faint = default shift
      </span>
      <span>WO = company week-off · L = on leave</span>
    </div>
  );
}

/** Phones: one day at a time, a row per person. Tap to select (the bar at the bottom sets the shift). */
function ByDay({
  data,
  cellShift,
  defaultOf,
  selected,
  setSelected,
  lockedCell,
  editable,
  shiftById,
}: {
  data: Roster;
  cellShift: (k: Key) => number | null;
  defaultOf: (p: RosterPerson) => number | null;
  selected: Set<Key>;
  setSelected: React.Dispatch<React.SetStateAction<Set<Key>>>;
  lockedCell: (k: Key) => boolean;
  editable: (p: RosterPerson) => boolean;
  shiftById: Map<number, Shift>;
}) {
  const today = todayLocal();
  const [day, setDay] = useState(() => data.days.find((d) => d.date === today)?.date ?? data.days[0]?.date);
  const info = data.days.find((d) => d.date === day) ?? data.days[0];
  return (
    <div className="space-y-2 max-sm:mb-48">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Day">
        {data.days.map((d) => (
          <button
            key={d.date}
            type="button"
            aria-pressed={d.date === info.date}
            onClick={() => setDay(d.date)}
            className={cn('flex h-12 min-w-12 shrink-0 cursor-pointer flex-col items-center justify-center rounded-md border bg-card text-xs', d.date === info.date && 'border-primary bg-primary/8 text-primary')}
          >
            <span>{d.weekday}</span>
            <span className="font-mono font-semibold">{dayNum(d.date)}</span>
          </button>
        ))}
      </div>
      <Card className="divide-y p-0">
        {data.people.map((p) => {
          const k = key(p.user_id, info.date);
          const sid = cellShift(k);
          const s = sid != null ? shiftById.get(sid) : undefined;
          const def = defaultOf(p);
          const ds = def != null ? shiftById.get(def) : undefined;
          const locked = lockedCell(k);
          const can = editable(p) && !locked;
          return (
            <button
              key={p.user_id}
              type="button"
              disabled={!can}
              aria-pressed={selected.has(k)}
              onClick={() =>
                setSelected((cur) => {
                  const n = new Set(cur);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  return n;
                })
              }
              className={cn('flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left disabled:cursor-not-allowed', selected.has(k) && 'bg-primary/8')}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.department || p.designation}</span>
              </span>
              {locked ? (
                <ShiftCode code="L" colour="info" title="On leave" />
              ) : s ? (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {s.is_off ? 'Off' : shiftHours(s.start, s.end)}
                  <ShiftCode code={s.code} colour={s.colour} />
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{info.week_off ? 'Week-off' : ds ? `Default ${ds.code}` : 'Office hours'}</span>
              )}
            </button>
          );
        })}
      </Card>
    </div>
  );
}

function PatternDialog({
  open,
  onClose,
  shifts,
  people,
  selectedOnly,
  apply,
}: {
  open: boolean;
  onClose: () => void;
  shifts: Shift[];
  people: RosterPerson[];
  selectedOnly: boolean;
  apply: (seq: number[], unit: 'week' | 'day', stagger: boolean) => void;
}) {
  const [seq, setSeq] = useState<number[]>([]);
  const [unit, setUnit] = useState<'week' | 'day'>('week');
  const [stagger, setStagger] = useState(false);
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Repeat a pattern</DialogTitle>
          <DialogDescription>
            For {selectedOnly ? 'the selected people' : 'everyone shown'} ({people.length}) over the days on screen. Tap shifts in order, e.g. G, M, N for a weekly rotation. Leave days and holidays are left alone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add to the pattern">
            {shifts.map((s) => (
              <button key={s.id} type="button" onClick={() => setSeq((x) => [...x, s.id].slice(0, 14))} className={cn('h-9 min-w-11 cursor-pointer rounded-md border px-2.5 font-mono text-sm font-bold', toneOf(s.colour))} title={`Add ${s.label}`}>
                {s.code}
              </button>
            ))}
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-dashed p-2" aria-live="polite">
            {seq.length ? seq.map((id, i) => <ShiftCode key={i} code={byId.get(id)?.code ?? '?'} colour={byId.get(id)?.colour ?? 'muted'} />) : <span className="text-sm text-muted-foreground">Pattern is empty</span>}
            {seq.length > 0 && (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setSeq([])}>
                Clear
              </Button>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pattern-unit">Each step lasts</Label>
            <NativeSelect id="pattern-unit" value={unit} onChange={(e) => setUnit(e.target.value as 'week' | 'day')}>
              <option value="week">A week (week-offs kept)</option>
              <option value="day">A day</option>
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={stagger} onCheckedChange={(c) => setStagger(c === true)} /> Stagger people (each person starts one step later, so shifts stay covered)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!seq.length || !people.length} onClick={() => apply(seq, unit, stagger)}>
            <Repeat /> Apply pattern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DefaultDialog({
  open,
  onClose,
  shifts,
  people,
  selectedOnly,
  current,
  apply,
}: {
  open: boolean;
  onClose: () => void;
  shifts: Shift[];
  people: RosterPerson[];
  selectedOnly: boolean;
  current: (p: RosterPerson) => number | null;
  apply: (people: RosterPerson[], shift: number | null) => void;
}) {
  const [shift, setShift] = useState('');
  const [who, setWho] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (open) setWho(new Set(selectedOnly ? people.map((p) => p.user_id) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Default shift</DialogTitle>
          <DialogDescription>A person's usual shift on days without a roster entry. Company week-offs still apply. Saved with the roster.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="default-shift">Shift</Label>
            <NativeSelect id="default-shift" value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">Office hours (no default shift)</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            <legend className="px-1 text-xs text-muted-foreground">People</legend>
            {people.map((p) => {
              const cur = current(p);
              return (
                <label key={p.user_id} className="flex min-h-9 items-center gap-2 text-sm">
                  <Checkbox
                    checked={who.has(p.user_id)}
                    onCheckedChange={(c) =>
                      setWho((s) => {
                        const n = new Set(s);
                        if (c === true) n.add(p.user_id);
                        else n.delete(p.user_id);
                        return n;
                      })
                    }
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{cur != null ? byId.get(cur)?.code : 'Office'}</span>
                </label>
              );
            })}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!who.size} onClick={() => apply(people.filter((p) => who.has(p.user_id)), shift ? Number(shift) : null)}>
            Set for {who.size} {who.size === 1 ? 'person' : 'people'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const imp = useImportRoster();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RosterImportResult | null>(null);
  const [done, setDone] = useState('');
  const reset = () => {
    setFile(null);
    setPreview(null);
    setDone('');
    imp.reset();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a roster</DialogTitle>
          <DialogDescription>Download the roster as Excel, change the shift codes (a dash clears a day), then upload it here. You see what changes before anything is saved.</DialogDescription>
        </DialogHeader>
        <input
          type="file"
          aria-label="Roster file"
          accept=".xlsx,.csv"
          className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:bg-card file:px-3 file:py-1.5"
          onChange={(e) => {
            setPreview(null);
            setDone('');
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        {preview && (
          <div className="space-y-1 text-sm">
            <p>
              {preview.changes} day{preview.changes === 1 ? '' : 's'} and {preview.defaults} default shift{preview.defaults === 1 ? '' : 's'} in the file.
            </p>
            {preview.problems.length > 0 && (
              <ul className="max-h-40 list-inside list-disc overflow-y-auto text-destructive">
                {preview.problems.map((p, i) => (
                  <li key={i}>
                    Row {p.line}: {p.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <OkNote>{done}</OkNote>
        {imp.error && <ErrorNote>{errorMessage(imp.error)}</ErrorNote>}
        <DialogFooter>
          <Button variant="outline" disabled={!file} loading={imp.isPending && !preview} onClick={() => file && imp.mutate({ file, dryRun: true }, { onSuccess: setPreview })}>
            Check file
          </Button>
          <Button
            disabled={!preview || preview.problems.length > 0 || !file || !!done}
            loading={imp.isPending && !!preview}
            onClick={() => file && imp.mutate({ file, dryRun: false }, { onSuccess: (r) => setDone(`Saved ${r.saved ?? 0} day(s).`) })}
          >
            <Upload /> Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
