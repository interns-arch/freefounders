/** Home dashboard (old pages/Home.jsx, HomeInsights.jsx, Delegation.jsx): /tasks/home/, /tasks/dashboard/, /dashboard/, delegation. */
import { useQuery } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';
import type { Task } from './types';

export type HomeRange = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
export const HOME_RANGES: Array<[HomeRange, string]> = [
  ['this_week', 'This week'],
  ['last_week', 'Last week'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['custom', 'Custom dates'],
];

export interface HomeFilters {
  range: HomeRange;
  start: string;
  end: string;
  department: string;
}

export interface HomeMistake {
  id: number;
  code: string;
  category: string;
  description: string;
  status_display: string;
  severity: string;
  severity_display: string;
  sla_due_at: string | null;
  is_overdue: boolean;
}

export interface HomeSummary {
  range: { start: string | null; end: string | null };
  previous?: { start: string | null; end: string | null };
  me: {
    score: number | null;
    score_prev: number | null;
    score_delta: number | null;
    on_time_rate: number | null;
    completed: number;
    in_time: number;
    delayed: number;
    mistakes_open: number;
    mistakes: HomeMistake[];
  };
  team: {
    people: number;
    departments: string[];
    open: number;
    overdue: number;
    overdue_by_person: Array<{ id: number; name: string; overdue: number; open: number }>;
    ageing: Array<{ label: string; count: number }>;
    top: Array<{ id: number; name: string; score: number; score_delta: number | null; on_time_rate: number | null; completed: number }>;
    attention: Array<{ id: number; name: string; role: string; reasons: string[] }>;
  } | null;
}

/** GET /tasks/home/?range=…&department=… — my score, deadlines and the team panels. Waits for both custom dates. */
export function useHomeSummary(f: HomeFilters) {
  const ready = f.range !== 'custom' || (!!f.start && !!f.end);
  const q = { range: f.range, start: f.range === 'custom' ? f.start : undefined, end: f.range === 'custom' ? f.end : undefined, department: f.department || undefined };
  return useQuery({ queryKey: ['tasks', 'home', q], queryFn: () => tasksApi.get<HomeSummary>('/tasks/home/', q), enabled: ready });
}

export interface MyTaskTiles {
  overdue: number;
  pending: number;
  in_progress: number;
  completed: number;
  in_time: number;
  delayed: number;
  total: number;
}

/** GET /tasks/dashboard/?scope=my&range=all — "My work" tiles. */
export function useMyTaskTiles() {
  return useQuery({
    queryKey: ['tasks', 'dashboard', 'my'],
    queryFn: () => tasksApi.get<{ tiles: MyTaskTiles }>('/tasks/dashboard/', { scope: 'my', range: 'all' }).then((d) => d.tiles),
  });
}

/** Open tasks I handed to someone else (first 10) and how many there are. */
export function useDelegatedOpen() {
  return useQuery({
    queryKey: ['tasks', 'delegated-open'],
    queryFn: async () => {
      const d = await tasksApi.get<DrfPage<Task> | Task[]>('/tasks/', { scope: 'delegated', status: 'open,in_progress', page_size: 10 });
      const rows = resultsOf(d);
      return { rows, total: Array.isArray(d) ? d.length : d.count };
    },
  });
}

const countOf = (d: DrfPage<unknown> | unknown[]) => (Array.isArray(d) ? d.length : d.count);

/** "Waiting on you": completions to accept and change requests to decide. */
export function useWaitingCounts() {
  return useQuery({
    queryKey: ['task-completions', 'waiting-counts'],
    queryFn: async () => {
      const [accept, requests] = await Promise.all([
        tasksApi.get<DrfPage<unknown> | unknown[]>('/task-completions/', { scope: 'inbox', page_size: 1 }).then(countOf).catch(() => 0),
        tasksApi.get<DrfPage<unknown> | unknown[]>('/task-change-requests/', { scope: 'inbox', page_size: 1 }).then(countOf).catch(() => 0),
      ]);
      return { accept, requests };
    },
  });
}

export interface LeadsDashboard {
  tiles: {
    open_tasks: number;
    overdue_tasks: number;
    total: number;
    new: number;
    active: number;
    won: number;
    lost: number;
    overdue: number;
    pending_followups: number;
    conversion_pct: number;
    pipeline_value: number;
  };
  status_dist: Array<{ status: string; label: string; count: number }>;
  per_day: Array<{ date: string; count: number }>;
  employees: Array<{ id: number; name: string; role: string; open_tasks: number; total: number; open: number; won: number; lost: number; overdue: number }>;
  sources: Array<{ source: string; label: string; total: number; won: number; conversion_pct: number }>;
  recent_inbound: Array<{ channel: string; sender: string; lead_name: string | null; status: string; body: string; created_at: string }>;
  recent_events: Array<{ lead_name: string; body: string; actor: string; created_at: string }>;
}

/** GET /dashboard/ — the leads half of Home (only when the person works leads). */
export function useLeadsDashboard(enabled: boolean) {
  return useQuery({ queryKey: ['tasks', 'leads-dashboard'], queryFn: () => tasksApi.get<LeadsDashboard>('/dashboard/'), enabled });
}

// ─── tasks given & received ──────────────────────────────────────────────

export type DelegationWindow = 'day' | 'week' | 'month' | 'all';
export const DELEGATION_WINDOWS: Array<[DelegationWindow, string]> = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['all', 'Overall'],
];
type Counts = Record<DelegationWindow, number>;

export interface DelegationReport {
  date: string;
  week: [string, string];
  month: [string, string];
  everyone: boolean;
  totals: Record<DelegationWindow, { given: number; self: number }>;
  people: Array<{ id: number; name: string; role: string; department: string; given: Counts; received: Counts; self: Counts }>;
  pairs: Array<{ from: string; to: string; count: number }>;
}

/** GET /tasks/delegation/?date=&department= — everyone's (admins) or my own numbers. */
export function useDelegationReport(date: string, department = '') {
  return useQuery({
    queryKey: ['tasks', 'delegation', date, department],
    queryFn: () => tasksApi.get<DelegationReport>('/tasks/delegation/', { date, department: department || undefined }),
  });
}

export interface PersonDelegation {
  date: string;
  week: [string, string];
  month: [string, string];
  person: { id: number; name: string; role: string };
  gave_to: Array<{ id: number; name: string; active: boolean } & Counts>;
  received_from: Array<{ id: number; name: string; active: boolean } & Counts>;
}

/** GET /tasks/delegation/person/?user=&date= — who this person gives tasks to and gets them from. */
export function usePersonDelegation(userId: number | null, date: string) {
  return useQuery({
    queryKey: ['tasks', 'delegation-person', userId, date],
    queryFn: () => tasksApi.get<PersonDelegation>('/tasks/delegation/person/', { user: userId!, date }),
    enabled: userId != null,
  });
}
