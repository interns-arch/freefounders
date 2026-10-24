import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { EXPORT_MAX } from '../common/export';
import type { SheetCell } from '../common/sheet';
import { DbService } from '../db/db.service';
import { companies, serviceHeartbeats, serviceLogs } from '../db/schema';
import { internalUrl } from '../provision/provision.client';
import { attachLogWriter, enqueueLogs, flushLogs, LOG_LEVELS, type LogInput, type LogRow, redactLog } from './log-sink';

const DAY_MS = 86_400_000;

/** Days the production log keeps (LOG_RETENTION_DAYS, default 30). */
export function logRetentionDays(): number {
  const n = Number(process.env.LOG_RETENTION_DAYS ?? 30);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

const entrySchema = z
  .object({
    at: z.string().max(40).optional(),
    level: z.string().max(10).optional(),
    kind: z.string().max(20).optional(),
    event: z.string().max(200).nullish(),
    message: z.string().max(4000),
    stack: z.string().max(20_000).nullish(),
    method: z.string().max(10).nullish(),
    path: z.string().max(2000).nullish(),
    status: z.number().int().nullish(),
    companyId: z.string().max(64).nullish(),
    userId: z.union([z.string().max(64), z.number()]).nullish(),
    count: z.number().int().nullish(),
  })
  .passthrough();

/** POST /internal/logs from Tasks, the Tasks worker and Assets (their reporters: tenancy/log_sink.py, common/log-sink.ts). */
export const ingestSchema = z.object({
  service: z.enum(['tasks', 'tasks-worker', 'assets']),
  version: z.string().max(60).nullish(),
  entries: z.array(entrySchema).max(100).default([]),
  heartbeat: z.object({ at: z.string().max(40).optional(), data: z.record(z.string(), z.unknown()).default({}) }).nullish(),
});

export const logsQuerySchema = z.object({
  service: z.string().trim().max(40).optional(),
  level: z.enum(LOG_LEVELS).optional(),
  company: z.string().trim().max(80).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;

const date = (v: string | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

@Injectable()
export class LogsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Logs');
  private cleanup?: NodeJS.Timeout;
  private codes = new Map<string, string>();

  constructor(private readonly dbs: DbService) {}

  onModuleInit() {
    attachLogWriter((rows) => this.write(rows));
    // 30-day retention: once shortly after start, then every 6 hours.
    const run = () => void this.purge().catch(() => undefined);
    const first = setTimeout(run, 60_000);
    first.unref();
    this.cleanup = setInterval(run, 6 * 3600_000);
    this.cleanup.unref();
  }

  async onModuleDestroy() {
    if (this.cleanup) clearInterval(this.cleanup);
    await flushLogs();
    attachLogWriter(null);
  }

  /** Inserts on the root pool (never inside a request's transaction). Fills the company code from the id. */
  private async write(rows: LogRow[]) {
    const ids = [...new Set(rows.map((r) => r.companyId).filter((x): x is string => !!x && !this.codes.has(x)))];
    if (ids.length) {
      const found = await this.dbs.root.select({ id: companies.id, code: companies.code }).from(companies).where(inArray(companies.id, ids));
      for (const c of found) this.codes.set(c.id, c.code);
      if (this.codes.size > 10_000) this.codes.clear();
    }
    await this.dbs.root.insert(serviceLogs).values(rows.map((r) => ({ ...r, companyCode: r.companyCode ?? (r.companyId ? (this.codes.get(r.companyId) ?? null) : null) })));
  }

  /** Deletes entries older than the retention. Returns how many went. */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - logRetentionDays() * DAY_MS);
    const gone = await this.dbs.root.delete(serviceLogs).where(lte(serviceLogs.at, cutoff)).returning({ id: serviceLogs.id });
    if (gone.length) this.log.log(`Production log: ${gone.length} entries older than ${logRetentionDays()} days removed`);
    return gone.length;
  }

  /**
   * Who may post: with LOG_SINK_TOKEN set, only a request carrying it (x-log-sink-token). Without it, only a direct call
   * on the internal network: anything that came through a proxy (X-Forwarded-For) is refused.
   */
  ingestAllowed(headers: Record<string, string | string[] | undefined>): boolean {
    const want = process.env.LOG_SINK_TOKEN?.trim();
    const got = headers['x-log-sink-token'];
    if (want) {
      const g = Buffer.from(typeof got === 'string' ? got : '');
      const w = Buffer.from(want);
      return g.length === w.length && timingSafeEqual(g, w);
    }
    return !headers['x-forwarded-for'] && !headers['forwarded'];
  }

  async ingest(body: z.infer<typeof ingestSchema>) {
    const accepted = enqueueLogs(
      body.entries.map(
        (e): LogInput => ({
          service: body.service,
          version: body.version ?? null,
          level: e.level as LogInput['level'],
          kind: e.kind === 'exception' ? 'exception' : 'event',
          event: e.event ?? null,
          message: e.message,
          stack: e.stack ?? null,
          method: e.method ?? null,
          path: e.path ?? null,
          status: e.status ?? null,
          companyId: e.companyId ?? null,
          userId: e.userId === null || e.userId === undefined ? null : String(e.userId),
          count: e.count ?? 1,
          at: e.at ? new Date(e.at) : undefined,
        }),
      ),
    );
    if (body.heartbeat) {
      // Only counts and small values are kept; strings are redacted.
      const data = JSON.parse(redactLog(JSON.stringify(body.heartbeat.data ?? {}).slice(0, 20_000))) as Record<string, unknown>;
      const service = body.service === 'tasks' ? 'tasks-worker' : body.service;
      await this.dbs.root
        .insert(serviceHeartbeats)
        .values({ service, at: new Date(), version: body.version ?? null, data })
        .onConflictDoUpdate({ target: serviceHeartbeats.service, set: { at: new Date(), version: body.version ?? null, data } });
    }
    return { accepted };
  }

  // ─── console (staff) ───────────────────────────────────────────────

  private where(q: LogsQuery): SQL | undefined {
    const conds: (SQL | undefined)[] = [];
    if (q.service) conds.push(eq(serviceLogs.service, q.service));
    if (q.level) conds.push(eq(serviceLogs.level, q.level));
    if (q.company) conds.push(/^[0-9a-f-]{36}$/i.test(q.company) ? eq(serviceLogs.companyId, q.company) : sql`upper(${serviceLogs.companyCode}) = ${q.company.toUpperCase()}`);
    const from = date(q.from);
    const to = date(q.to);
    if (from) conds.push(gte(serviceLogs.at, from));
    if (to) conds.push(lte(serviceLogs.at, to));
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(or(ilike(serviceLogs.message, like), ilike(serviceLogs.path, like), ilike(serviceLogs.event, like)));
    }
    return conds.length ? and(...conds) : undefined;
  }

  async list(q: LogsQuery) {
    await flushLogs();
    const where = this.where(q);
    const [{ total }] = await this.dbs.root.select({ total: sql<number>`count(*)::int` }).from(serviceLogs).where(where);
    const rows = await this.dbs.root
      .select()
      .from(serviceLogs)
      .where(where)
      .orderBy(desc(serviceLogs.at), desc(serviceLogs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const services = await this.dbs.root.selectDistinct({ s: serviceLogs.service }).from(serviceLogs);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      services: [...new Set(['platform', 'tasks', 'tasks-worker', 'assets', ...services.map((s) => s.s)])],
      retentionDays: logRetentionDays(),
      rows: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
    };
  }

  async sheet(q: LogsQuery) {
    const { rows } = await this.list({ ...q, page: 1, pageSize: EXPORT_MAX });
    return {
      header: ['When', 'Service', 'Level', 'Kind', 'Event', 'Message', 'Method', 'Path', 'Status', 'Company', 'User', 'Count', 'Version', 'Stack'],
      rows: rows.map((r) => [new Date(r.at), r.service, r.level, r.kind, r.event ?? '', r.message, r.method ?? '', r.path ?? '', r.status ?? '', r.companyCode ?? '', r.userId ?? '', r.count, r.version ?? '', r.stack ?? ''] as SheetCell[]),
    };
  }

  /** Errors in the last 24 h per service (Overview + Health). */
  private async recentErrors() {
    const rows = await this.dbs.root
      .select({ service: serviceLogs.service, n: sql<number>`sum(${serviceLogs.count})::int`, last: sql<Date | null>`max(${serviceLogs.at})` })
      .from(serviceLogs)
      .where(and(eq(serviceLogs.level, 'error'), gte(serviceLogs.at, new Date(Date.now() - DAY_MS))))
      .groupBy(serviceLogs.service);
    return new Map(rows.map((r) => [r.service, { n: r.n, last: r.last ? new Date(r.last).toISOString() : null }]));
  }

  /** Health strip: each service up / down + version, the Tasks worker's last pass, errors in 24 h. */
  async health() {
    const probe = async (url: string | null) => {
      if (!url) return { up: null as boolean | null, version: null as string | null, ms: null as number | null, note: 'not connected' };
      const t = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const body = (await res.json().catch(() => null)) as { version?: string | null } | null;
        return { up: res.ok, version: body?.version ?? null, ms: Date.now() - t, note: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { up: false, version: null, ms: Date.now() - t, note: (err as Error).name === 'TimeoutError' ? 'no answer in 3 s' : 'unreachable' };
      }
    };
    const tasks = internalUrl('tasks');
    const assets = internalUrl('assets');
    const [t, a, beats, errors] = await Promise.all([
      probe(tasks ? new URL('/health', tasks).toString() : null),
      probe(assets ? `${assets.replace(/\/internal$/, '')}/health` : null),
      this.dbs.root.select().from(serviceHeartbeats),
      this.recentErrors(),
    ]);
    const worker = beats.find((b) => b.service === 'tasks-worker');
    const workerAge = worker ? Date.now() - worker.at.getTime() : null;
    const err = (s: string) => errors.get(s) ?? { n: 0, last: null };
    return {
      checkedAt: new Date().toISOString(),
      services: [
        { service: 'platform', label: 'Platform', up: true, version: process.env.APP_VERSION || null, ms: 0, note: null, errors24h: err('platform').n, lastError: err('platform').last },
        { service: 'tasks', label: 'Tasks', ...t, errors24h: err('tasks').n, lastError: err('tasks').last },
        {
          service: 'tasks-worker',
          label: 'Tasks worker',
          // A pass runs every 5 minutes: 15 minutes without one means it is stuck or stopped.
          up: worker ? workerAge! < 15 * 60_000 : null,
          version: worker?.version ?? null,
          ms: null,
          note: worker ? null : 'no heartbeat yet',
          lastRun: worker?.at.toISOString() ?? null,
          lastResults: (worker?.data as { results?: unknown } | undefined)?.results ?? null,
          errors24h: err('tasks-worker').n,
          lastError: err('tasks-worker').last,
        },
        { service: 'assets', label: 'Assets', ...a, errors24h: err('assets').n, lastError: err('assets').last },
      ],
    };
  }

  /** Punch-ins today from the Tasks worker's last heartbeat (it counts them per company on every pass). */
  async punchesToday(): Promise<{ total: number | null; at: string | null }> {
    const [beat] = await this.dbs.root.select().from(serviceHeartbeats).where(eq(serviceHeartbeats.service, 'tasks-worker')).limit(1);
    const total = (beat?.data as { punchesToday?: { total?: unknown } } | undefined)?.punchesToday?.total;
    const sameDay = beat && new Date(beat.at).toDateString() === new Date().toDateString();
    return { total: sameDay && typeof total === 'number' ? total : null, at: beat ? beat.at.toISOString() : null };
  }

  async errorsToday() {
    const [r] = await this.dbs.root
      .select({ n: sql<number>`coalesce(sum(${serviceLogs.count}), 0)::int` })
      .from(serviceLogs)
      .where(and(eq(serviceLogs.level, 'error'), gte(serviceLogs.at, sql`date_trunc('day', now())`)));
    return r?.n ?? 0;
  }
}
