/**
 * Roster management (PLAN.md §28): the shift library, the people × days roster (HR / managers with "Roster and
 * shifts"), My roster for everyone, export / import. A person's shift for a day = roster entry, else their default
 * shift, else the company office hours; the API applies it to every attendance rule.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';

/** A shift's colour is the name of a theme token; the web maps it to its own classes (no hex anywhere). */
export const SHIFT_COLOURS = ['primary', 'cta', 'success', 'warning', 'info', 'destructive', 'attendance', 'tasks', 'assets', 'visitors', 'muted'] as const;
export type ShiftColour = (typeof SHIFT_COLOURS)[number];

export interface Shift {
  id: number;
  name: string;
  /** 1–4 letters: G, M, N, OFF. */
  code: string;
  /** 'HH:MM'; empty for the Off shift. End not after start = overnight. */
  start: string;
  end: string;
  break_minutes: number;
  /** null = the company's HR rule. */
  grace_minutes: number | null;
  half_day_hours: number | null;
  colour: ShiftColour;
  is_off: boolean;
  active: boolean;
  order: number;
  overnight: boolean;
  /** "Night 22:00–06:00" / "Off". */
  label: string;
}

export type ShiftInput = Partial<Omit<Shift, 'id' | 'overnight' | 'label'>>;

export interface RosterDay {
  date: string;
  weekday: string;
  holiday: string | null;
  /** A company week-off weekday (people without a roster entry are off). */
  week_off: boolean;
}

export interface RosterPerson {
  user_id: number;
  name: string;
  employee_code: string;
  department: string;
  department_code: string;
  designation: string;
  manager_id: number | null;
  /** Their usual shift when the roster has no entry (null = office hours). */
  default_shift: number | null;
  is_self: boolean;
}

export interface RosterEntry {
  user: number;
  date: string;
  shift: number;
}

export interface RosterLeave {
  user: number;
  date: string;
  type: string;
  half_day: boolean;
  status: 'approved' | 'pending';
}

export interface RosterWarning {
  user: number;
  date: string;
  rest_hours: number;
  message: string;
}

export interface Roster {
  from: string;
  to: string;
  days: RosterDay[];
  people: RosterPerson[];
  entries: RosterEntry[];
  leaves: RosterLeave[];
  shifts: Shift[];
  office: { start: string; end: string; week_offs: number[] };
  warnings: RosterWarning[];
  min_rest_hours: number;
  scope: 'team' | 'department' | 'company';
  can_edit_shifts: boolean;
  /** False: the viewer's own row is read-only (only the Owner plans their own roster). */
  can_edit_self: boolean;
  departments: Array<{ code: string; name: string }>;
  managers: Array<{ id: number; name: string }>;
}

export interface RosterFilters {
  from: string;
  to: string;
  department?: string;
  manager?: number | '';
  q?: string;
}

export interface RosterChange {
  user: number;
  date: string;
  /** null = clear the day (back to the default shift / office hours). */
  shift: number | null;
}

export interface RosterSave {
  changes?: RosterChange[];
  defaults?: Array<{ user: number; shift: number | null }>;
}

export interface MyRosterDay {
  date: string;
  weekday: string;
  off: boolean;
  holiday: string | null;
  leave: { type: string; half_day: boolean; status: string } | null;
  source: 'roster' | 'default' | 'office';
  start: string;
  end: string;
  overnight: boolean;
  code: string;
  name: string;
  colour: ShiftColour | '';
}

const rosterQuery = (f: RosterFilters) => ({ from: f.from, to: f.to, department: f.department || undefined, manager: f.manager || undefined, q: f.q?.trim() || undefined });

/** GET /hr/shifts/ (?all=1 with archived ones). */
export function useShifts(all = false) {
  return useQuery({ queryKey: ['hr', 'shifts', all], queryFn: () => tasksApi.get<Shift[]>('/hr/shifts/', { all: all ? 1 : undefined }) });
}

/** POST /hr/shifts/ or PATCH /hr/shifts/:id/ (company-scope roster planners). */
export function useSaveShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ShiftInput & { id?: number }) => (id ? tasksApi.patch<Shift>(`/hr/shifts/${id}/`, body) : tasksApi.post<Shift>('/hr/shifts/', body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'shifts'] });
      qc.invalidateQueries({ queryKey: ['hr', 'roster'] });
    },
  });
}

/** GET /hr/roster/?from&to&department&manager&q (at most 62 days). */
export function useRoster(f: RosterFilters, enabled = true) {
  return useQuery({
    queryKey: ['hr', 'roster', f.from, f.to, f.department ?? '', f.manager ?? '', f.q?.trim() ?? ''],
    queryFn: () => tasksApi.get<Roster>('/hr/roster/', rosterQuery(f)),
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** Read the roster for another range once (Copy last week). */
export function useFetchRoster() {
  return useMutation({ mutationFn: (f: RosterFilters) => tasksApi.get<Roster>('/hr/roster/', rosterQuery(f)) });
}

/** PUT /hr/roster/ — all or nothing; the people whose shifts changed are told in-app. */
export function useSaveRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RosterSave) => tasksApi.put<{ saved: number; defaults: number; notified: number }>('/hr/roster/', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'roster'] });
      qc.invalidateQueries({ queryKey: ['hr', 'my-roster'] });
    },
  });
}

/** GET /hr/roster/?export=xlsx|csv — the roster as a file (same filters). */
export function useDownloadRoster() {
  return useMutation({
    mutationFn: async ({ format, ...f }: RosterFilters & { format: 'xlsx' | 'csv' }) => ({
      filename: `roster-${f.from}-to-${f.to}.${format}`,
      blob: await tasksApi.blob('/hr/roster/', { ...rosterQuery(f), export: format }),
    }),
  });
}

export interface RosterImportResult {
  dry_run: boolean;
  changes: number;
  defaults: number;
  problems: Array<{ line: number; error: string }>;
  saved?: number;
  notified?: number;
}

/** POST /hr/roster/import/ (multipart: file, dry_run) — the exported file, edited. */
export function useImportRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('dry_run', dryRun ? 'true' : 'false');
      return tasksApi.upload<RosterImportResult>('/hr/roster/import/', form);
    },
    onSuccess: (res) => {
      if (!res.dry_run) qc.invalidateQueries({ queryKey: ['hr', 'roster'] });
    },
  });
}

/** GET /hr/roster/mine/?days — the signed-in person's next days. */
export function useMyRoster(days = 14) {
  return useQuery({
    queryKey: ['hr', 'my-roster', days],
    queryFn: () => tasksApi.get<{ from: string; to: string; days: MyRosterDay[]; uses_roster: boolean }>('/hr/roster/mine/', { days }),
  });
}
