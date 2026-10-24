// Production log: ships unhandled 500s and ERROR log lines to the Kaampilot Platform's log sink.
// OFF unless PLATFORM_LOG_URL is set (standalone installs and tests unchanged). It never blocks or fails a request:
// entries are buffered in memory and POSTed by an unref'd timer (20 entries or 2 s after the first; HTTP timeout 3 s;
// every error swallowed). At most 60 entries a minute per process; identical entries (level + message + path)
// within 60 s are folded into one with a `count`. Everything is redacted before it is buffered.
// Env: PLATFORM_LOG_URL, LOG_SINK_TOKEN (optional header x-log-sink-token), APP_VERSION.
import { ConsoleLogger } from '@nestjs/common';

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogEntryInput {
  level?: LogLevel;
  kind?: 'exception' | 'event';
  event?: string;
  message: string;
  stack?: string;
  method?: string;
  path?: string;
  status?: number;
  companyId?: string;
  userId?: string;
}

interface LogEntry extends LogEntryInput {
  at: string;
  level: LogLevel;
  kind: 'exception' | 'event';
  count: number;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_BATCH = 50;
const MAX_BUFFER = 200;
const FLUSH_AT = 20;
const FLUSH_AFTER_MS = 2000;
const HTTP_TIMEOUT_MS = 3000;
const RATE_PER_MINUTE = 60;
const FOLD_MS = 60_000;

const SERVICE = 'assets';

let buffer: LogEntry[] = [];
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> = Promise.resolve();
let reporting = false;
const seen = new Map<string, { until: number; entry: LogEntry; sent: boolean; extra: number }>();
const rate = { minute: 0, count: 0 };

export function logSinkEnabled(): boolean {
  return Boolean(process.env.PLATFORM_LOG_URL?.trim());
}

const REDACTIONS: [RegExp, string][] = [
  [/Bearer\s+[^\s"',]+/gi, 'Bearer [hidden]'],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/(password|passwd|pwd|secret|token|otp|code|authkey|api[_-]?key|signature)\s*["']?\s*[:=]\s*["']?[^\s"',&}]+/gi, '$1=[hidden]'],
  [/params:.*/g, 'params: [hidden]'],
  [/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2'],
  [/\b\d{6,}\b/g, '[digits]'],
];

/** Hides tokens, secrets, Postgres parameter values, emails and long digit runs. */
export function redact(text: string | undefined | null): string {
  if (!text) return '';
  let out = String(text);
  for (const [pattern, repl] of REDACTIONS) out = out.replace(pattern, repl);
  return out;
}

/** Path without query string or fragment. */
export function cleanPath(path: string | undefined | null): string | undefined {
  if (!path) return undefined;
  return redact(String(path).split('?')[0].split('#')[0]).slice(0, 300);
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? '';
}

/** Queues one entry (redacted, rate limited, folded). Never throws. Returns true when queued or folded. */
export function reportLog(input: LogEntryInput): boolean {
  if (!logSinkEnabled() || reporting) return false;
  reporting = true;
  try {
    const level = input.level ?? 'error';
    const message = redact(firstLine(input.message ?? '')).slice(0, MAX_MESSAGE);
    const path = cleanPath(input.path);
    const entry: LogEntry = { at: new Date().toISOString(), level, kind: input.kind ?? 'event', message, count: 1 };
    if (input.stack) {
      const stack = redact(input.stack);
      entry.stack = stack.length > MAX_STACK ? stack.slice(-MAX_STACK) : stack;
    }
    if (input.event) entry.event = input.event;
    if (input.method) entry.method = input.method;
    if (path) entry.path = path;
    if (typeof input.status === 'number') entry.status = input.status;
    if (input.companyId) entry.companyId = input.companyId;
    if (input.userId) entry.userId = input.userId;

    const key = `${level}\u0000${message}\u0000${path ?? ''}`;
    const now = Date.now();
    const prior = seen.get(key);
    if (prior && now < prior.until) {
      if (!prior.sent) prior.entry.count += 1;
      else prior.extra += 1;
      return true;
    }
    const minute = Math.floor(now / 60_000);
    if (rate.minute !== minute) {
      rate.minute = minute;
      rate.count = 0;
    }
    if (rate.count >= RATE_PER_MINUTE || buffer.length >= MAX_BUFFER) return false;
    rate.count += 1;
    if (seen.size > 500) for (const [k, v] of seen) if (now >= v.until) seen.delete(k);
    seen.set(key, { until: now + FOLD_MS, entry, sent: false, extra: 0 });
    buffer.push(entry);
    schedule(buffer.length >= FLUSH_AT ? 0 : FLUSH_AFTER_MS);
    return true;
  } catch {
    return false;
  } finally {
    reporting = false;
  }
}

/** An Error (or anything thrown) as an exception entry. */
export function reportException(err: unknown, context: Omit<LogEntryInput, 'message' | 'stack' | 'kind'> = {}): boolean {
  try {
    const e = err instanceof Error ? err : null;
    const message = e ? `${e.name || 'Error'}: ${e.message}` : String(err);
    return reportLog({ ...context, kind: 'exception', message, stack: e?.stack });
  } catch {
    return false;
  }
}

function schedule(delay: number) {
  if (timer && delay > 0) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushLogSink();
  }, delay);
  timer.unref();
}

function sweepFolded(now: number): LogEntry[] {
  const out: LogEntry[] = [];
  for (const [k, v] of seen) {
    if (now < v.until) continue;
    if (v.extra > 0) out.push({ ...v.entry, at: new Date().toISOString(), count: v.extra });
    seen.delete(k);
  }
  return out;
}

async function post(entries: LogEntry[]): Promise<void> {
  const url = process.env.PLATFORM_LOG_URL?.trim();
  if (!url || entries.length === 0) return;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.LOG_SINK_TOKEN) headers['x-log-sink-token'] = process.env.LOG_SINK_TOKEN;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ service: SERVICE, version: process.env.APP_VERSION || null, entries }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => undefined);
  } catch {
    // sink down or slow: drop silently
  }
}

/** Sends everything buffered now. Resolves when the send finished or failed; never rejects. */
export function flushLogSink(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = buffer;
  buffer = [];
  for (const e of batch) {
    const s = seen.get(`${e.level}\u0000${e.message}\u0000${e.path ?? ''}`);
    if (s && s.entry === e) s.sent = true;
  }
  const entries = [...batch.map((e) => ({ ...e })), ...sweepFolded(Date.now())];
  const run = async () => {
    for (let i = 0; i < entries.length; i += MAX_BATCH) await post(entries.slice(i, i + MAX_BATCH));
  };
  inFlight = inFlight.then(run, run).catch(() => undefined);
  return inFlight;
}

export function resetLogSinkForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  buffer = [];
  seen.clear();
  rate.minute = 0;
  rate.count = 0;
}

/**
 * Nest logger that also reports `error()` lines. Context 'HTTP' is skipped: the exception filter reports those
 * itself, with the request context.
 */
export class ReportingLogger extends ConsoleLogger {
  error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...(rest as []));
    try {
      if (!logSinkEnabled()) return;
      const context = rest.length > 0 && typeof rest[rest.length - 1] === 'string' ? (rest[rest.length - 1] as string) : this.context;
      if (context === 'HTTP') return;
      const stack = rest.length > 1 && typeof rest[0] === 'string' ? (rest[0] as string) : undefined;
      if (message instanceof Error) {
        reportException(message, { event: context ? `nest.${context}` : undefined });
      } else {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        reportLog({ kind: stack ? 'exception' : 'event', message: text, stack, event: context ? `nest.${context}` : undefined });
      }
    } catch {
      // never let logging fail the caller
    }
  }
}
