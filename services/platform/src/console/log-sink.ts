/**
 * Production log sink (PLAN.md §21.9): the one place every service's errors and key events end up (platform.service_logs).
 *
 * - The Platform writes its own entries through `platformLog()` (exception filter, `ReportingLogger`, OTP / sign-in /
 *   webhook events). Tasks, the Tasks worker and Assets POST theirs to `/internal/logs` (LogsController), which is
 *   outside `/api/platform` and so never reachable through the public gateway.
 * - Everything is redacted here again (defence in depth: the apps already redact): no bearer tokens / JWTs, nothing that
 *   looks like `password=`, `token=`, `otp=`, `code=`…, no SQL parameter values, emails masked, long digit runs hidden,
 *   paths without their query string. Request bodies and headers are never accepted.
 * - Writing never blocks or fails a request: entries are buffered in memory and inserted by a timer on the root pool
 *   (outside any open transaction); a failed insert is dropped. Rate limited per service (LOG_RATE_PER_MINUTE, 300).
 */
import { ConsoleLogger } from '@nestjs/common';

export const LOG_LEVELS = ['error', 'warn', 'info'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const LOG_SERVICES = ['platform', 'tasks', 'tasks-worker', 'assets'] as const;

export interface LogInput {
  service?: string;
  level?: LogLevel;
  kind?: 'exception' | 'event';
  event?: string | null;
  message: string;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  companyId?: string | null;
  companyCode?: string | null;
  userId?: string | null;
  count?: number;
  version?: string | null;
  at?: Date;
}

export interface LogRow {
  at: Date;
  service: string;
  level: LogLevel;
  kind: string;
  event: string | null;
  message: string;
  stack: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  companyId: string | null;
  companyCode: string | null;
  userId: string | null;
  count: number;
  version: string | null;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_BUFFER = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REDACTIONS: [RegExp, string][] = [
  [/Bearer\s+[^\s"',]+/gi, 'Bearer [hidden]'],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/(password|passwd|pwd|secret|token|otp|code|authkey|api[_-]?key|signature|cookie)\s*["']?\s*[:=]\s*["']?[^\s"',&}]+/gi, '$1=[hidden]'],
  [/params:.*/g, 'params: [hidden]'],
  [/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2'],
  [/\b\d{6,}\b/g, '[digits]'],
];

/** Hides secrets, tokens, codes, SQL parameter values, emails and long digit runs (OTP codes, mobile numbers). */
export function redactLog(text: string | null | undefined): string {
  if (!text) return '';
  let out = String(text);
  for (const [re, repl] of REDACTIONS) out = out.replace(re, repl);
  return out;
}

const short = (v: unknown, max: number) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max));

/** One clean, redacted row from anything a service sent (unknown fields dropped). */
export function cleanLog(input: LogInput): LogRow {
  const level: LogLevel = LOG_LEVELS.includes(input.level as LogLevel) ? (input.level as LogLevel) : 'error';
  const message = redactLog(String(input.message ?? '').trim().split(/\r?\n/)[0]).slice(0, MAX_MESSAGE) || '(no message)';
  const stackRaw = input.stack ? redactLog(String(input.stack)) : null;
  const path = input.path ? redactLog(String(input.path).split('?')[0].split('#')[0]).slice(0, 300) : null;
  const status = Number.isInteger(input.status) && (input.status as number) >= 100 && (input.status as number) < 600 ? (input.status as number) : null;
  const companyId = input.companyId && UUID.test(String(input.companyId)) ? String(input.companyId) : null;
  const at = input.at instanceof Date && !Number.isNaN(input.at.getTime()) && Math.abs(Date.now() - input.at.getTime()) < 86_400_000 ? input.at : new Date();
  return {
    at,
    service: short(input.service, 40) ?? 'platform',
    level,
    kind: input.kind === 'exception' ? 'exception' : 'event',
    event: short(input.event ? redactLog(input.event) : null, 80),
    message,
    stack: stackRaw ? (stackRaw.length > MAX_STACK ? stackRaw.slice(-MAX_STACK) : stackRaw) : null,
    method: input.method && /^[A-Z]{3,7}$/.test(String(input.method)) ? String(input.method) : null,
    path,
    status,
    companyId,
    companyCode: short(input.companyCode, 40),
    userId: short(input.userId ? redactLog(String(input.userId)) : null, 64),
    count: Number.isInteger(input.count) && (input.count as number) > 0 ? Math.min(input.count as number, 1_000_000) : 1,
    version: short(input.version, 60),
  };
}

/** Per-service limit: entries a minute the sink keeps (LOG_RATE_PER_MINUTE, default 300). Read on every call. */
export function logRatePerMinute(): number {
  const n = Number(process.env.LOG_RATE_PER_MINUTE ?? 300);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

type Writer = (rows: LogRow[]) => Promise<void>;
let writer: Writer | null = null;
let buffer: LogRow[] = [];
let timer: NodeJS.Timeout | null = null;
const rate = new Map<string, { minute: number; count: number }>();
let dropped = 0;

function allowed(service: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const r = rate.get(service);
  if (!r || r.minute !== minute) {
    rate.set(service, { minute, count: 1 });
    return true;
  }
  if (r.count >= logRatePerMinute()) return false;
  r.count += 1;
  return true;
}

/** Queues entries for the database. Never throws; returns how many were kept (rate limit / buffer full drop the rest). */
export function enqueueLogs(inputs: LogInput[]): number {
  let kept = 0;
  for (const input of inputs) {
    try {
      const row = cleanLog(input);
      if (!allowed(row.service) || buffer.length >= MAX_BUFFER) {
        dropped += 1;
        continue;
      }
      buffer.push(row);
      kept += 1;
    } catch {
      dropped += 1;
    }
  }
  if (kept && writer && !timer) {
    timer = setTimeout(() => void flushLogs(), 200);
    timer.unref();
  }
  return kept;
}

/** The Platform's own entry (service `platform`). Never throws. */
export function platformLog(input: Omit<LogInput, 'service'>): void {
  enqueueLogs([{ ...input, service: 'platform', version: process.env.APP_VERSION || null }]);
}

/** An exception as a Platform entry. */
export function platformException(err: unknown, context: Omit<LogInput, 'service' | 'message' | 'stack' | 'kind'> = {}): void {
  const e = err instanceof Error ? err : null;
  platformLog({ ...context, kind: 'exception', message: e ? `${e.name || 'Error'}: ${e.message}` : String(err), stack: e?.stack ?? null });
}

/** Writes what is buffered now. Never rejects. */
export async function flushLogs(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!writer || !buffer.length) return;
  const rows = buffer;
  buffer = [];
  try {
    await writer(rows);
  } catch {
    dropped += rows.length;
  }
}

/** LogsService attaches the database writer at start-up; until then (and in scripts) entries wait in the buffer. */
export function attachLogWriter(w: Writer | null) {
  writer = w;
  if (w && buffer.length) void flushLogs();
}

/** Tests only. */
export function resetLogSink() {
  buffer = [];
  rate.clear();
  dropped = 0;
}
export const logSinkStats = () => ({ buffered: buffer.length, dropped });

/**
 * Nest logger that also records `error()` lines (poller, billing clock, provisioning…) in the production log. Context
 * 'HTTP' is skipped: the exception filter records those itself, with the request.
 */
export class ReportingLogger extends ConsoleLogger {
  error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...(rest as []));
    try {
      const context = rest.length > 0 && typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : this.context;
      if (context === 'HTTP') return;
      const stack = rest.length > 1 && typeof rest[0] === 'string' ? (rest[0] as string) : null;
      if (message instanceof Error) platformException(message, { event: context ? `nest.${context}` : null });
      else platformLog({ level: 'error', kind: stack ? 'exception' : 'event', message: typeof message === 'string' ? message : JSON.stringify(message), stack, event: context ? `nest.${context}` : null });
    } catch {
      // logging never fails its caller
    }
  }
}
