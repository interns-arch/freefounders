/**
 * "Ask Kaampilot" data answers (PLAN.md §24.3 "Data answers", 2026-10-28): read-only tools the model may call while the
 * person is signed in. Every tool reads through the apps' own HTTP APIs **with the asking person's own access token**
 * (`Authorization: Bearer <their Platform token>`), exactly like the web app does. So the apps' existing checks decide
 * what comes back: permissions, role scopes (Own / Team / Department / Company), plan areas (§24.1), module switches and
 * company isolation (§14). Nothing here reads a database, uses a service token or sends anything but GET.
 *
 * Answers are trimmed before they reach the AI provider: only the fields a question needs, at most 50 rows, no
 * photos / links / phone numbers / e-mail addresses / places, times in IST.
 */

export type DataApp = 'tasks' | 'assets' | 'platform';
export type ToolStatus = 'ok' | 'not_allowed' | 'not_available' | 'failed' | 'bad_input';

/** The asking person, from their verified access token. The token is only ever forwarded to our own apps. */
export interface ToolUser {
  token: string;
  name: string;
  role: string;
  apps: Partial<Record<'tasks' | 'assets', string>>;
}

export interface ToolCallLog {
  name: string;
  status: ToolStatus;
  ms: number;
}

export const MAX_ROWS = 50;
const MAX_STRING = 300;
const MAX_DEPTH = 6;
/** One tool answer, as JSON, at most this many characters. */
export const MAX_RESULT_CHARS = 12_000;
const APP_TIMEOUT_MS = 8_000;
const IST = 'Asia/Kolkata';

/** Where each app's API answers inside the deployment (the same services the gateway routes to). */
export function appBaseUrl(app: DataApp, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const clean = (u: string | undefined) => u?.trim().replace(/\/+$/, '') || undefined;
  if (app === 'platform') return clean(env.PLATFORM_SELF_URL) ?? `http://127.0.0.1:${env.PORT?.trim() || 4000}/api/platform`;
  const explicit = clean(env[`${app.toUpperCase()}_API_URL`]);
  if (explicit) return explicit;
  // TASKS_INTERNAL_URL = http://tasks:8000/api/internal → the API itself is http://tasks:8000/api
  return clean(env[`${app.toUpperCase()}_INTERNAL_URL`])?.replace(/\/internal$/, '');
}

/** An app answered something other than 200 (or could not be reached). */
export class AppReadError extends Error {
  constructor(readonly status: number | 'network' | 'timeout' | 'off') {
    super(`app read ${status}`);
  }
}

export interface ReadContext {
  user: ToolUser;
  get<T = unknown>(app: DataApp, path: string, query?: Record<string, string | number | undefined>): Promise<T>;
}

/** GET only, with the person's own token. `deadline` = the question's overall time limit. */
export function makeReader(user: ToolUser, fetchImpl: typeof fetch, deadline: number, env: NodeJS.ProcessEnv = process.env): ReadContext {
  return {
    user,
    async get<T>(app: DataApp, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
      const base = appBaseUrl(app, env);
      if (!base) throw new AppReadError('off');
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, String(v));
      const url = `${base}${path}${q.size ? `?${q}` : ''}`;
      const left = deadline - Date.now();
      if (left <= 200) throw new AppReadError('timeout');
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${user.token}`, accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(APP_TIMEOUT_MS, left)),
        });
      } catch (err) {
        const name = (err as Error)?.name;
        throw new AppReadError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
      }
      if (!res.ok) throw new AppReadError(res.status);
      try {
        return (await res.json()) as T;
      } catch {
        throw new AppReadError('network');
      }
    },
  };
}

// ─── trimming ───────────────────────────────────────────────────────────────

/** Fields never sent to the AI provider: links, photos, secrets, places, contact details. */
const DROP_KEY =
  /((^|_)urls?($|_)|Url$|href|link|photo|selfie|image|avatar|logo|token|password|secret|otp|latitude|longitude|^lat$|^lng$|^lon$|geo|mobile|phone|whatsapp|email|aadhaar|^pan$|bank|ifsc|^ip$|user_?agent|capabilit|permission|^channels$|^id_type$|^id_last4$|colou?r$|^icon$|attachment|document|signature|^batch$|^short_code$|^pass_no$)/i;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const istFormat = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "2026-10-28T03:42:00Z" → "2026-10-28 09:12 IST". */
export function toIst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${istFormat.format(d).replace(', ', ' ')} IST`;
}

/** Today in India: { date: '2026-10-28', year: 2026, month: 10 }. */
export function istToday(now = new Date()): { date: string; year: number; month: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { date, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** Recursively trims an app answer: drops the fields above and empty values, caps rows / strings / depth, IST times. */
export function slim(value: unknown, rows = MAX_ROWS, depth = 0): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return undefined;
    if (ISO_TIME.test(s)) return toIst(s);
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const out = value.slice(0, rows).map((v) => slim(v, rows, depth + 1)).filter((v) => v !== undefined);
    if (value.length > rows) out.push(`… and ${value.length - rows} more not shown`);
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEY.test(k)) continue;
      const s = slim(v, rows, depth + 1);
      if (s !== undefined && !(Array.isArray(s) && !s.length)) out[k] = s;
    }
    return out;
  }
  return undefined;
}

/** The JSON a tool hands to the model: trimmed, and shrunk further if still too long. */
export function toolJson(data: unknown): string {
  for (const rows of [MAX_ROWS, 20, 10]) {
    const s = JSON.stringify(slim(data, rows) ?? {});
    if (s.length <= MAX_RESULT_CHARS) return s;
  }
  return JSON.stringify({ note: 'The answer was too long; only the start is shown.', start: JSON.stringify(slim(data, 5)).slice(0, MAX_RESULT_CHARS - 200) });
}

function pick<T extends object>(row: T | null | undefined, keys: Array<keyof T>): Partial<T> | null {
  if (!row) return null;
  const out: Partial<T> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

type Page<T> = { count?: number; results?: T[] } | T[];
const rowsOf = <T>(d: Page<T>): T[] => (Array.isArray(d) ? d : (d?.results ?? []));
const countOf = <T>(d: Page<T>): number => (Array.isArray(d) ? d.length : (d?.count ?? rowsOf(d).length));
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const nameOf = (u: unknown) => (u && typeof u === 'object' ? ((u as Obj).name ?? null) : null);

// ─── tools ──────────────────────────────────────────────────────────────────

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

export interface DataTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** The app the person must have for this tool to be offered (the app still checks everything itself). */
  needs?: 'tasks' | 'assets';
  run(ctx: ReadContext, input: Obj): Promise<unknown>;
}

const NO_INPUT: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const RANGE = { type: 'string', enum: ['this_week', 'this_month', 'last_month', 'this_quarter'], description: 'Period; default this_month.' };
const MONTH = { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'A month as YYYY-MM; default the current month (IST).' };
const PERSON_ID = { type: 'integer', description: 'The person id from find_people.' };

class BadInput extends Error {}

function monthOf(input: Obj): { year: number; month: number } {
  const t = istToday();
  if (input.month === undefined || input.month === null || input.month === '') return { year: t.year, month: t.month };
  const m = /^(\d{4})-(\d{2})$/.exec(String(input.month));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new BadInput('month must be YYYY-MM');
  return { year: Number(m[1]), month: Number(m[2]) };
}
const rangeOf = (input: Obj) => {
  const r = input.range ?? 'this_month';
  if (!['this_week', 'this_month', 'last_month', 'this_quarter'].includes(r)) throw new BadInput('unknown range');
  return r as string;
};
const personId = (input: Obj) => {
  const id = Number(input.person_id);
  if (!Number.isInteger(id) || id <= 0) throw new BadInput('person_id must be a number from find_people');
  return id;
};

export const DATA_TOOLS: DataTool[] = [
  {
    name: 'my_profile',
    description: "The signed-in person's own profile: name, access level, apps, department, designation/role, manager, join date, which modules are on.",
    parameters: NO_INPUT,
    async run(ctx) {
      const out: Obj = { name: ctx.user.name, access_level: ctx.user.role, apps: Object.keys(ctx.user.apps) };
      if (ctx.user.apps.tasks) {
        const me = await ctx.get<Obj>('tasks', '/auth/me');
        out.profile = pick(me, ['username', 'role_display', 'department_display', 'reporting_manager_name', 'date_joined', 'level', 'modules', 'team360']);
      }
      return out;
    },
  },
  {
    name: 'my_attendance',
    description: "The signed-in person's own attendance: today's punch (check-in/out, late, day off) and one month day by day with totals (present, late, absent, leave…, hours).",
    parameters: { type: 'object', properties: { month: MONTH }, additionalProperties: false },
    needs: 'tasks',
    async run(ctx, input) {
      const { year, month } = monthOf(input);
      const t = istToday();
      const current = year === t.year && month === t.month;
      const [today, monthly] = await Promise.all([
        current ? ctx.get<Obj>('tasks', '/attendance/today/') : Promise.resolve(null),
        ctx.get<Obj>('tasks', '/attendance/monthly/', { year, month }),
      ]);
      return {
        today: today
          ? { date: t.date, ...pick(today.attendance ?? {}, ['status', 'check_in', 'check_out', 'working_minutes', 'is_late', 'is_early_checkout', 'missing_checkout', 'regularized']), day_off: today.day_off, work_start: today.work_start, work_end: today.work_end, punched_in: !!today.attendance?.check_in }
          : undefined,
        month: {
          year,
          month,
          totals: monthly.totals,
          total_hours: monthly.total_hours,
          days: ((monthly.days ?? []) as Obj[])
            .filter((d) => d.status || d.holiday)
            .map((d) => pick(d, ['date', 'status', 'holiday', 'check_in', 'check_out', 'working_minutes', 'is_late', 'regularized', 'work_mode'])),
        },
      };
    },
  },
  {
    name: 'my_leave',
    description: "The signed-in person's own leave balances (per leave type: quota, used, balance, pending) and their leave requests with status.",
    parameters: NO_INPUT,
    needs: 'tasks',
    async run(ctx) {
      const [balances, requests] = await Promise.all([
        ctx.get<Page<Obj>>('tasks', '/leaves/balances/'),
        ctx.get<Page<Obj>>('tasks', '/leaves/', { page_size: MAX_ROWS }),
      ]);
      return {
        balances: rowsOf(balances).map((b) => pick(b, ['name', 'paid', 'quota', 'used', 'balance', 'pending', 'available', 'limited'])),
        requests_total: countOf(requests),
        requests: rowsOf(requests).map((r) => ({
          ...pick(r, ['leave_type_name', 'start_date', 'end_date', 'days', 'leave_days', 'half_day', 'status', 'reason', 'remarks', 'created_at']),
          reviewed_by: nameOf(r.reviewed_by_detail),
        })),
      };
    },
  },
  {
    name: 'my_regularizations',
    description: "The signed-in person's own attendance regularization requests (missed punch, on duty, WFH…) with status and remarks.",
    parameters: NO_INPUT,
    needs: 'tasks',
    async run(ctx) {
      const d = await ctx.get<Page<Obj>>('tasks', '/attendance-corrections/', { page_size: MAX_ROWS });
      return {
        total: countOf(d),
        rows: rowsOf(d).map((r) => ({
          ...pick(r, ['date', 'reason_label', 'reason', 'status', 'requested_check_in', 'requested_check_out', 'remarks', 'reviewed_at', 'auto_approved']),
          reviewed_by: nameOf(r.reviewed_by_detail),
        })),
      };
    },
  },
  {
    name: 'my_tasks',
    description: "The signed-in person's own tasks (assigned to them): counts (overdue, pending, in progress, completed, in time, delayed) and a list filtered by open / overdue / done.",
    parameters: { type: 'object', properties: { filter: { type: 'string', enum: ['open', 'overdue', 'done'], description: 'Which list; default open.' } }, additionalProperties: false },
    needs: 'tasks',
    async run(ctx, input) {
      const filter = input.filter ?? 'open';
      if (!['open', 'overdue', 'done'].includes(filter)) throw new BadInput('unknown filter');
      const q: Obj = { scope: 'my', page_size: MAX_ROWS };
      if (filter === 'open') q.status = 'open,in_progress';
      if (filter === 'overdue') q.overdue = 'true';
      if (filter === 'done') q.status = 'done';
      const [dash, list] = await Promise.all([
        ctx.get<Obj>('tasks', '/tasks/dashboard/', { scope: 'my', range: 'all' }),
        ctx.get<Page<Obj>>('tasks', '/tasks/', q),
      ]);
      return {
        counts: dash?.tiles ?? null,
        filter,
        total: countOf(list),
        rows: rowsOf(list).map((t) => ({
          ...pick(t, ['code', 'title', 'status', 'priority', 'due_at', 'is_overdue', 'completed_at', 'category', 'frequency_display']),
          given_by: nameOf(t.created_by_detail),
        })),
      };
    },
  },
  {
    name: 'team_today',
    description:
      "Attendance of the people the signed-in person may see (their team / department / company, decided by the app) for today or one date: counts per status and who is present, late, absent, on leave or not punched in. Refused for people without team attendance access.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD; default today (IST).' },
        status: { type: 'string', enum: ['present', 'late', 'half_day', 'absent', 'leave', 'not_checked_in', 'holiday', 'week_off'], description: 'Only people with this status (late = checked in late).' },
        department: { type: 'string', description: 'A department code, to narrow the list.' },
      },
      additionalProperties: false,
    },
    needs: 'tasks',
    async run(ctx, input) {
      if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.date))) throw new BadInput('date must be YYYY-MM-DD');
      const d = await ctx.get<Obj>('tasks', '/attendance/team_day/', { date: input.date, department: input.department });
      const all = ((d.rows ?? []) as Obj[]).filter((r) => r.is_active !== false);
      const counts: Record<string, number> = {};
      for (const r of all) counts[r.status ?? 'nothing_recorded'] = (counts[r.status ?? 'nothing_recorded'] ?? 0) + 1;
      const late = all.filter((r) => r.is_late || r.status === 'late').length;
      const rows = input.status === 'late' ? all.filter((r) => r.is_late || r.status === 'late') : input.status ? all.filter((r) => r.status === input.status) : all;
      return {
        date: d.date,
        holiday: d.holiday,
        week_off: d.week_off,
        people: all.length,
        counts,
        checked_in_late: late,
        filter: input.status ?? null,
        rows: rows.map((r) => pick(r, ['name', 'employee_code', 'department', 'designation', 'status', 'check_in', 'check_out', 'is_late', 'working_minutes', 'regularized'])),
      };
    },
  },
  {
    name: 'my_roster',
    description:
      "The signed-in person's own shifts (roster) for the next days: per date the shift name/code and hours, or off day, holiday or leave. Use for 'what is my shift tomorrow', 'when is my next off day'.",
    parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 31, description: 'How many days from today; default 14.' } }, additionalProperties: false },
    needs: 'tasks',
    async run(ctx, input) {
      const days = input.days === undefined ? 14 : Number(input.days);
      if (!Number.isInteger(days) || days < 1 || days > 31) throw new BadInput('days must be 1-31');
      const d = await ctx.get<Obj>('tasks', '/hr/roster/mine/', { days });
      return {
        from: d.from,
        to: d.to,
        uses_roster: d.uses_roster,
        days: ((d.days ?? []) as Obj[]).map((x) => ({
          ...pick(x, ['date', 'weekday', 'off', 'holiday', 'name', 'code', 'start', 'end', 'overnight', 'source']),
          leave: x.leave ? pick(x.leave as Obj, ['type', 'half_day', 'status']) : undefined,
        })),
      };
    },
  },
  {
    name: 'team_roster',
    description:
      "The roster (who works which shift on which day) of the people the signed-in person plans (their team / department / company, decided by the app) for up to 31 days from a date. Refused for people without roster access.",
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD; default this week Monday.' },
        days: { type: 'integer', minimum: 1, maximum: 31, description: 'How many days; default 7.' },
        department: { type: 'string', description: 'A department code, to narrow the list.' },
      },
      additionalProperties: false,
    },
    needs: 'tasks',
    async run(ctx, input) {
      if (input.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.from))) throw new BadInput('from must be YYYY-MM-DD');
      const n = input.days === undefined ? 7 : Number(input.days);
      if (!Number.isInteger(n) || n < 1 || n > 31) throw new BadInput('days must be 1-31');
      const query: Record<string, string | number | undefined> = { department: input.department };
      if (input.from) {
        const start = new Date(`${input.from}T00:00:00Z`);
        query.from = String(input.from);
        query.to = new Date(start.getTime() + (n - 1) * 86_400_000).toISOString().slice(0, 10);
      }
      const d = await ctx.get<Obj>('tasks', '/hr/roster/', query);
      const shifts = new Map(((d.shifts ?? []) as Obj[]).map((s) => [s.id, s]));
      const cells = new Map<string, Obj>();
      for (const e of (d.entries ?? []) as Obj[]) cells.set(`${e.user}|${e.date}`, shifts.get(e.shift) ?? {});
      const dates = ((d.days ?? []) as Obj[]).map((x) => x.date as string);
      return {
        from: d.from,
        to: d.to,
        office_hours: d.office,
        shifts: [...shifts.values()].map((s) => pick(s, ['code', 'name', 'start', 'end', 'is_off'])),
        people: ((d.people ?? []) as Obj[]).map((p) => ({
          name: p.name,
          department: p.department,
          default_shift: p.default_shift ? (shifts.get(p.default_shift) as Obj | undefined)?.code ?? null : null,
          days: Object.fromEntries(dates.map((date) => [date, (cells.get(`${p.user_id}|${date}`) as Obj | undefined)?.code ?? null])),
        })),
        rest_warnings: ((d.warnings ?? []) as Obj[]).length,
        note: 'A null day = no roster entry: the default shift (or the office hours); company week-offs still apply then.',
      };
    },
  },
  {
    name: 'find_people',
    description:
      "People the signed-in person may see in Team 360 (by name, employee code or username), each with today's status, this month's attendance % / late / leave / absent days and open / overdue / done tasks. Without a name it lists everyone in their scope (sorted as asked). Use it first to get a person_id. Refused for people without Team 360 access.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Part of a name, employee code or username.' },
        sort: { type: 'string', enum: ['name', 'overdue', 'attendance', 'late_days', 'tasks_done'], description: 'Order of the list; default name.' },
      },
      additionalProperties: false,
    },
    needs: 'tasks',
    async run(ctx, input) {
      const d = await ctx.get<Obj>('tasks', '/team360/');
      const words = String(input.name ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      let rows = ((d.rows ?? []) as Obj[]).filter((r) => {
        const hay = `${r.name ?? ''} ${r.employee_code ?? ''} ${r.username ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const by: Record<string, (r: Obj) => number> = {
        overdue: (r) => -(r.tasks?.overdue ?? 0),
        attendance: (r) => -(r.month?.attendance_rate ?? -1),
        late_days: (r) => -(r.month?.late_days ?? 0),
        tasks_done: (r) => -(r.tasks?.done_this_month ?? 0),
      };
      const key = by[input.sort as string];
      rows = key ? [...rows].sort((a, b) => key(a) - key(b)) : [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return {
        scope: d.scope,
        today: d.today,
        month: d.month,
        matches: rows.length,
        people: rows.map((r) => ({
          person_id: r.id,
          ...pick(r, ['name', 'employee_code', 'designation', 'department', 'is_self', 'today', 'month', 'tasks']),
          manager: nameOf(r.manager),
        })),
      };
    },
  },
  {
    name: 'person_report',
    description: "One person's Team 360 numbers for a period: attendance % and days (present, late, half, absent, leave), average hours, regularizations, leave balances, tasks assigned / completed / on time / overdue, score. Only for people the signed-in person may see.",
    parameters: { type: 'object', properties: { person_id: PERSON_ID, range: RANGE }, required: ['person_id'], additionalProperties: false },
    needs: 'tasks',
    async run(ctx, input) {
      const d = await ctx.get<Obj>('tasks', `/team360/${personId(input)}/`, { range: rangeOf(input) });
      return {
        person: { ...pick(d.person ?? {}, ['name', 'employee_code', 'designation', 'department', 'roles', 'join_date', 'is_active', 'reports']), manager: nameOf(d.person?.manager) },
        period: d.period,
        attendance: d.attendance,
        tasks: d.tasks,
      };
    },
  },
  {
    name: 'person_attendance_days',
    description: "One person's attendance for a month, day by day, with their regularizations and leave requests that month. Only for people the signed-in person may see.",
    parameters: { type: 'object', properties: { person_id: PERSON_ID, month: MONTH }, required: ['person_id'], additionalProperties: false },
    needs: 'tasks',
    async run(ctx, input) {
      const id = personId(input);
      const { year, month } = monthOf(input);
      const d = await ctx.get<Obj>('tasks', `/team360/${id}/attendance/`, { year, month });
      return {
        year,
        month,
        totals: d.totals,
        days: ((d.days ?? []) as Obj[]).filter((x) => x.status || x.holiday).map((x) => pick(x, ['date', 'status', 'holiday', 'check_in', 'check_out', 'working_minutes', 'is_late', 'regularized'])),
        regularizations: d.regularizations,
        leave_requests: d.leave_requests ?? d.leaves,
        leave_balances: d.leave_balances,
      };
    },
  },
  {
    name: 'person_tasks',
    description: "One person's tasks: open (overdue first) and completed in a period, with on-time rate. Only for people the signed-in person may see.",
    parameters: { type: 'object', properties: { person_id: PERSON_ID, range: RANGE }, required: ['person_id'], additionalProperties: false },
    needs: 'tasks',
    async run(ctx, input) {
      const d = await ctx.get<Obj>('tasks', `/team360/${personId(input)}/tasks/`, { range: rangeOf(input) });
      return { period: d.period, on_time_rate: d.on_time_rate, open: d.open, open_more: d.open_more, completed: d.completed, completed_more: d.completed_more };
    },
  },
  {
    name: 'my_notifications',
    description: "The signed-in person's own notifications: unread counts and the latest ones (title, text, area, read or not).",
    parameters: NO_INPUT,
    async run(ctx) {
      const out: Obj = {};
      if (ctx.user.apps.tasks) {
        const [count, list] = await Promise.all([
          ctx.get<Obj>('tasks', '/notifications/unread_count/'),
          ctx.get<Page<Obj>>('tasks', '/notifications/', { page_size: 20 }),
        ]);
        out.tasks_and_attendance = {
          unread: count?.count,
          unread_by_area: count?.by_category,
          latest: rowsOf(list).map((n) => ({ ...pick(n, ['title', 'body', 'category', 'created_at']), read: !!n.read_at })),
        };
      }
      if (ctx.user.apps.assets) {
        const a = await ctx.get<Obj>('assets', '/notifications').catch(() => null);
        if (a) out.assets = { unread: a.unread, latest: ((a.items ?? []) as Obj[]).slice(0, 20).map((n) => ({ ...pick(n, ['title', 'body', 'category', 'createdAt']), read: !!n.readAt })) };
      }
      return out;
    },
  },
  {
    name: 'assets_overview',
    description: "Assets: the assets the signed-in person holds, their asset requests and tickets; for people with the Assets dashboard permission also company-wide asset counts (by status, category, warranties ending, open exits).",
    parameters: NO_INPUT,
    needs: 'assets',
    async run(ctx) {
      const dash = await ctx.get<Obj>('assets', '/dashboard');
      if (dash?.scope === 'personal') return dash;
      const me = await ctx.get<Obj>('assets', '/auth/me').catch(() => null);
      const mine = me?.employee?.id ? await ctx.get<Obj[]>('assets', `/employees/${encodeURIComponent(me.employee.id)}/assets`).catch(() => null) : null;
      return { my_assets: mine, company: dash };
    },
  },
  {
    name: 'visitors_today',
    description: "Today's visitors at the company gate (name, company, host, purpose, status, in/out times). Only when the Visitors module is on and the person may see visits.",
    parameters: NO_INPUT,
    needs: 'tasks',
    async run(ctx) {
      const d = await ctx.get<Page<Obj>>('tasks', '/visitors/visits/', { scope: 'today', page_size: MAX_ROWS });
      return {
        date: istToday().date,
        total: countOf(d),
        rows: rowsOf(d).map((v) => ({ ...pick(v, ['name', 'company', 'host_label', 'purpose', 'people', 'status_display', 'check_in_at', 'check_out_at']), host: nameOf(v.host) })),
      };
    },
  },
  {
    name: 'billing_plan',
    description: "The company's Kaampilot plan and billing: plan, state (trial / active…), users, renewal / trial end, amount. Only for the owner or people allowed to manage billing.",
    parameters: NO_INPUT,
    async run(ctx) {
      return ctx.get<Obj>('platform', '/billing');
    },
  },
];

/** The tools offered to this person: only for the apps they have (each app still checks every call). */
export function toolsFor(user: ToolUser | null | undefined): DataTool[] {
  if (!user?.token) return [];
  return DATA_TOOLS.filter((t) => !t.needs || !!user.apps[t.needs]);
}

/** Runs one tool call and returns the text for the model plus the status for the log (never the payload). */
export async function runTool(ctx: ReadContext, tools: DataTool[], name: string, rawInput: unknown): Promise<{ text: string; status: ToolStatus }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { text: JSON.stringify({ error: 'unknown_tool', message: 'There is no such tool.' }), status: 'bad_input' };
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? (rawInput as Obj) : {};
  try {
    return { text: toolJson(await tool.run(ctx, input)), status: 'ok' };
  } catch (err) {
    if (err instanceof BadInput) return { text: JSON.stringify({ error: 'bad_input', message: err.message }), status: 'bad_input' };
    const s = err instanceof AppReadError ? err.status : 'network';
    if (s === 401 || s === 403 || s === 402)
      return { text: JSON.stringify({ error: 'not_allowed', message: 'Not allowed: this person does not have access to this data (their role, plan or module does not include it).' }), status: 'not_allowed' };
    if (s === 404 || s === 'off')
      return { text: JSON.stringify({ error: 'not_available', message: 'Not available: this data does not exist or this person cannot see it.' }), status: 'not_available' };
    return { text: JSON.stringify({ error: 'failed', message: 'This data could not be loaded right now.' }), status: 'failed' };
  }
}
