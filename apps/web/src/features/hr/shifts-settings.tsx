/** HR settings › Shifts (PLAN.md §28.1): the company's shift library for the roster, and the rest-time warning. */
import { ApiError, errorMessage } from '@kaampilot/core';
import { SHIFT_COLOURS, type Shift, type ShiftColour, useHrSettings, useSaveHrSettings, useSaveShift, useShifts } from '@kaampilot/core/hr';
import { CalendarClock, Pencil } from '@/components/icons';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Chip, ErrorNote, OkNote, Panel } from '../tasks/general/parts';
import { SHIFT_COLOUR_NAMES, SHIFT_SWATCH, ShiftCode, shiftHours } from './shift-parts';

type Draft = {
  id?: number;
  name: string;
  code: string;
  start: string;
  end: string;
  break_minutes: string;
  grace_minutes: string;
  half_day_hours: string;
  colour: ShiftColour;
  is_off: boolean;
};
const EMPTY: Draft = { name: '', code: '', start: '09:00', end: '18:00', break_minutes: '60', grace_minutes: '', half_day_hours: '', colour: 'primary', is_off: false };

export function ShiftsSettings() {
  const q = useShifts(true);
  const save = useSaveShift();
  const [d, setD] = useState<Draft>(EMPTY);
  const [msg, setMsg] = useState('');
  const fieldErrors = save.error instanceof ApiError ? (save.error.errors ?? {}) : {};
  const fe = (k: string) => fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;
  const edit = (s: Shift) =>
    setD({
      id: s.id,
      name: s.name,
      code: s.code,
      start: s.start || '09:00',
      end: s.end || '18:00',
      break_minutes: String(s.break_minutes),
      grace_minutes: s.grace_minutes == null ? '' : String(s.grace_minutes),
      half_day_hours: s.half_day_hours == null ? '' : String(s.half_day_hours),
      colour: s.colour,
      is_off: s.is_off,
    });
  const overnight = !d.is_off && !!d.start && !!d.end && d.end <= d.start;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    save.mutate(
      {
        id: d.id,
        name: d.name,
        code: d.code,
        is_off: d.is_off,
        ...(d.is_off ? {} : { start: d.start, end: d.end }),
        break_minutes: Number(d.break_minutes || 0),
        grace_minutes: d.grace_minutes === '' ? null : Number(d.grace_minutes),
        half_day_hours: d.half_day_hours === '' ? null : Number(d.half_day_hours),
        colour: d.colour,
      },
      {
        onSuccess: () => {
          setMsg(d.id ? 'Shift saved' : 'Shift added');
          setD(EMPTY);
        },
      },
    );
  };
  return (
    <Panel
      icon={CalendarClock}
      tone="info"
      title="Shifts"
      description="The shifts you plan on Attendance › Roster. A shift that ends before it starts runs overnight (counted on its start day). Empty grace / half-day use the attendance rules above. People without a roster entry or default shift keep the office hours."
    >
      <ul className="divide-y">
        {q.data?.map((s) => (
          <li key={s.id} className={cn('flex items-center justify-between gap-2 py-2', !s.active && 'opacity-70')}>
            <div className="flex min-w-0 items-center gap-2.5">
              <ShiftCode code={s.code} colour={s.colour} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.is_off ? 'Day off' : shiftHours(s.start, s.end, s.overnight)}
                  {!s.is_off && s.break_minutes ? ` · break ${s.break_minutes} min` : ''}
                  {s.grace_minutes != null ? ` · grace ${s.grace_minutes} min` : ''}
                  {s.half_day_hours != null ? ` · half day under ${s.half_day_hours} h` : ''}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {!s.active && <Chip>Archived</Chip>}
              <Button size="icon-xs" variant="ghost" aria-label={`Edit shift ${s.name}`} onClick={() => edit(s)}>
                <Pencil />
              </Button>
              <Button size="xs" variant="ghost" onClick={() => save.mutate({ id: s.id, active: !s.active })}>
                {s.active ? 'Archive' : 'Restore'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3" aria-label={d.id ? 'Edit shift' : 'Add a shift'}>
        <div className="text-sm font-semibold">{d.id ? `Edit ${d.name || 'shift'}` : 'Add a shift'}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sh-name">Name</Label>
            <Input id="sh-name" value={d.name} placeholder="e.g. Night" onChange={(e) => setD({ ...d, name: e.target.value })} />
            {fe('name')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sh-code">Code</Label>
            <Input id="sh-code" value={d.code} maxLength={4} placeholder="N" className="font-mono uppercase" onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} />
            {fe('code')}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={d.is_off} onCheckedChange={(c) => setD({ ...d, is_off: c === true })} /> Day off (no hours, never absent)
        </label>
        {!d.is_off && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sh-start">Starts</Label>
              <Input id="sh-start" type="time" value={d.start} onChange={(e) => setD({ ...d, start: e.target.value })} />
              {fe('start')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sh-end">Ends</Label>
              <Input id="sh-end" type="time" value={d.end} onChange={(e) => setD({ ...d, end: e.target.value })} />
              {overnight && <p className="text-xs text-muted-foreground">Overnight: ends the next day.</p>}
              {fe('end')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sh-break">Break (min)</Label>
              <Input id="sh-break" type="number" min={0} value={d.break_minutes} onChange={(e) => setD({ ...d, break_minutes: e.target.value })} />
              {fe('break_minutes')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sh-grace">Grace (min)</Label>
              <Input id="sh-grace" type="number" min={0} placeholder="Company rule" value={d.grace_minutes} onChange={(e) => setD({ ...d, grace_minutes: e.target.value })} />
              {fe('grace_minutes')}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sh-half">Half day under (h)</Label>
              <Input id="sh-half" type="number" step="0.5" min={0.5} placeholder="Company rule" value={d.half_day_hours} onChange={(e) => setD({ ...d, half_day_hours: e.target.value })} />
              {fe('half_day_hours')}
            </div>
          </div>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Colour</legend>
          <div className="flex flex-wrap gap-1.5">
            {SHIFT_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={d.colour === c}
                aria-label={SHIFT_COLOUR_NAMES[c]}
                title={SHIFT_COLOUR_NAMES[c]}
                onClick={() => setD({ ...d, colour: c })}
                className={cn('flex size-9 cursor-pointer items-center justify-center rounded-full border-2 border-transparent', d.colour === c && 'border-foreground')}
              >
                <span className={cn('size-6 rounded-full', SHIFT_SWATCH[c])} />
              </button>
            ))}
          </div>
        </fieldset>
        {save.error && !Object.keys(fieldErrors).length && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
        <OkNote>{msg}</OkNote>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!d.name.trim() || !d.code.trim()} loading={save.isPending}>
            {d.id ? 'Save shift' : 'Add shift'}
          </Button>
          {d.id && (
            <Button type="button" variant="outline" onClick={() => setD(EMPTY)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
      <RestHours />
    </Panel>
  );
}

/** "Warn when rest between two shifts is under N hours" (ROSTER_MIN_REST_HOURS; 0 = no warning). */
function RestHours() {
  const q = useHrSettings();
  const save = useSaveHrSettings();
  const [v, setV] = useState('');
  const [ok, setOk] = useState('');
  useEffect(() => {
    if (q.data && v === '') setV(String(q.data.roster_min_rest_hours?.value ?? 11));
  }, [q.data, v]);
  if (!q.data) return null;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="sh-rest">Warn when rest between shifts is under (hours)</Label>
        <Input id="sh-rest" type="number" min={0} max={24} className="w-28" value={v} onChange={(e) => setV(e.target.value)} />
      </div>
      <Button variant="outline" loading={save.isPending} onClick={() => save.mutate({ roster_min_rest_hours: Number(v) }, { onSuccess: () => setOk('Saved') })}>
        Save
      </Button>
      <OkNote>{ok}</OkNote>
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
    </div>
  );
}
