import { ForbiddenException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, eventCursors, people, personApps, personRoles, roles } from '../db/schema';
import { internalUrl, ProvisionClient } from '../provision/provision.client';
import { DirectoryService } from './directory.service';

export const exitSchema = z.object({
  lastWorkingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31'),
  reason: z.string().trim().max(300).nullable().optional(),
});

interface AppEvent {
  id: number;
  type: string;
  payload: Record<string, any>;
}

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * Cross-app rules (PLAN.md §17.4). Each app keeps an outbox of events; the Platform reads them with its service
 * token (no new credential) and acts:
 *   ticket.created (Assets)  → a Tasks task for the IT owner, linked both ways
 *   task.completed (Tasks)   → the linked Assets ticket is resolved
 *   exit.completed (Assets)  → the person is switched off everywhere
 * plus two rules started here: "Start exit" in the portal, and onboarding for a new joiner.
 */
@Injectable()
export class FlowsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Flows');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
    private readonly auth: AuthService,
    private readonly directory: DirectoryService,
  ) {}

  onModuleInit() {
    const seconds = Number(process.env.EVENT_POLL_SECONDS ?? 30);
    if (process.env.NODE_ENV === 'test' || process.env.FF_CLI === 'true' || !seconds) return;
    this.timer = setInterval(() => void this.pollAll().catch((err) => this.log.error(`Event poll: ${(err as Error).message}`)), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── reading the apps' outboxes ──────────────────────────────────────────

  /** One pass over every active company and app. Returns how many events were handled. */
  async pollAll(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let handled = 0;
    try {
      const rows = await this.dbs.db.select({ id: companies.id, apps: companies.enabledApps }).from(companies).where(eq(companies.status, 'active')).orderBy(asc(companies.createdAt));
      for (const c of rows) {
        for (const app of c.apps.filter((a): a is AppKey => (APPS as readonly string[]).includes(a) && !!internalUrl(a as AppKey))) {
          try {
            handled += await this.pollApp(c.id, app);
          } catch (err) {
            this.log.warn(`Events from ${app} for company ${c.id}: ${(err as Error).message}`); // app down: next pass
          }
        }
      }
    } finally {
      this.running = false;
    }
    return handled;
  }

  async pollApp(companyId: string, app: AppKey): Promise<number> {
    const db = this.dbs.db;
    const [cursor] = await db.select().from(eventCursors).where(and(eq(eventCursors.companyId, companyId), eq(eventCursors.app, app))).limit(1);
    const events = await this.provisioner.internal<AppEvent[]>(app, 'GET', `/events?after=${cursor?.lastId ?? 0}`, companyId);
    for (const e of events) {
      try {
        await this.handle(companyId, app, e);
      } catch (err) {
        // A rule that fails is logged and skipped, so one bad event never blocks the ones after it.
        this.log.error(`Rule for ${app} event ${e.type} #${e.id} (company ${companyId}) failed: ${(err as Error).message}`);
      }
      await db
        .insert(eventCursors)
        .values({ companyId, app, lastId: e.id })
        .onConflictDoUpdate({ target: [eventCursors.companyId, eventCursors.app], set: { lastId: e.id, updatedAt: new Date() } });
    }
    return events.length;
  }

  private async handle(companyId: string, app: AppKey, e: AppEvent) {
    if (app === 'assets' && e.type === 'ticket.created') return this.ticketToTask(companyId, e.payload);
    if (app === 'tasks' && e.type === 'task.completed') return this.resolveTicket(companyId, e.payload);
    if (app === 'assets' && e.type === 'exit.completed') return this.switchOff(companyId, e.payload.personIds ?? []);
  }

  /** Tasks people among these Platform people (same company, active, with Tasks), in the order given. */
  private async withTasks(companyId: string, personIds: string[]): Promise<string[]> {
    if (!personIds.length) return [];
    const rows = await this.dbs.db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personApps, and(eq(personApps.personId, people.id), eq(personApps.app, 'tasks')))
      .where(and(eq(people.companyId, companyId), eq(people.status, 'active'), inArray(people.id, personIds)));
    const ok = new Set(rows.map((r) => r.id));
    return personIds.filter((p) => ok.has(p));
  }

  private async ticketToTask(companyId: string, p: Record<string, any>) {
    const [owner] = await this.withTasks(companyId, p.ownerPersonIds ?? []);
    if (!owner) {
      this.log.warn(`Ticket ${p.number}: nobody who manages tickets has Tasks, so no task was made`);
      return;
    }
    const task = await this.provisioner.internal<{ taskId: number; code: string; url: string }>('tasks', 'POST', '/tasks', companyId, {
      assigneePersonId: owner,
      title: `${p.number}: ${p.title}`,
      description: [p.description, p.asset ? `Asset: ${p.asset}` : null, `Raised by ${p.reporter} in Assets.`].filter(Boolean).join('\n'),
      priority: p.priority,
      externalRef: `assets:ticket:${p.ticketId}`,
      externalUrl: `/assets/tickets?open=${p.ticketId}`,
    });
    await this.provisioner.internal('assets', 'PUT', `/tickets/${p.ticketId}/link`, companyId, { assigneePersonId: owner, ref: task.code, url: task.url });
  }

  private async resolveTicket(companyId: string, p: Record<string, any>) {
    const ref = String(p.externalRef ?? '');
    if (!ref.startsWith('assets:ticket:')) return;
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, companyId));
    if (!c?.apps.includes('assets') || !internalUrl('assets')) return;
    await this.provisioner.internal('assets', 'POST', `/tickets/${ref.slice('assets:ticket:'.length)}/resolve`, companyId, {
      resolution: p.remarks ? `${p.remarks} (${p.code} in Tasks)` : null,
    });
  }

  /** The exit is complete: the person can no longer sign in anywhere, and the apps switch them off too. */
  private async switchOff(companyId: string, personIds: string[]) {
    if (!personIds.length) return;
    const rows = await this.dbs.db
      .update(people)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(people.companyId, companyId), inArray(people.id, personIds), eq(people.status, 'active')))
      .returning({ id: people.id });
    for (const r of rows) await this.auth.revokeAll(r.id);
    if (rows.length) await this.directory.push(companyId);
  }

  // ─── started from the portal ────────────────────────────────────────────

  /** "Start exit": Assets opens the exit case (assets to recover); Tasks makes the exit checklist. */
  async startExit(caller: Caller, personId: string, input: z.infer<typeof exitSchema>) {
    const db = this.dbs.db;
    const [p] = await db.select().from(people).where(and(eq(people.id, personId), eq(people.companyId, caller.companyId))).limit(1);
    if (!p) throw notFound('Person');
    if (p.status !== 'active') throw badRequest('This person is already inactive');
    if (personId === caller.personId) throw badRequest('You cannot start your own exit');
    if (caller.role === 'member' && p.platformRole !== 'member') throw new ForbiddenException('Only an owner or admin can start an admin’s exit');
    await db.update(people).set({ lastWorkingDate: input.lastWorkingDate, updatedAt: new Date() }).where(eq(people.id, personId));
    const apps = (await db.select({ app: personApps.app }).from(personApps).where(eq(personApps.personId, personId))).map((r) => r.app);
    const body = { personId, lastWorkingDate: input.lastWorkingDate, reason: input.reason ?? null };
    const result: Record<string, unknown> = { lastWorkingDate: input.lastWorkingDate };
    for (const [app, path] of [
      ['assets', '/exits'],
      ['tasks', '/exit-tasks'],
    ] as const) {
      if (!apps.includes(app) || !internalUrl(app)) continue;
      try {
        result[app] = await this.provisioner.internal(app, 'POST', path, caller.companyId, body);
      } catch (err) {
        result[app] = { error: (err as Error).message };
      }
    }
    return result;
  }

  /**
   * A new joiner (join date today or later) who has just been given Assets gets an onboarding case, with the
   * Assets kit named like one of their roles. Never throws: the person is already set up either way.
   */
  async onboardIfJoining(companyId: string, personId: string) {
    try {
      const [p] = await this.dbs.db.select({ joinDate: people.joinDate }).from(people).where(eq(people.id, personId)).limit(1);
      if (!p?.joinDate || p.joinDate < today() || !internalUrl('assets')) return null;
      const names = await this.dbs.db
        .select({ name: roles.name })
        .from(personRoles)
        .innerJoin(roles, eq(roles.id, personRoles.roleId))
        .where(eq(personRoles.personId, personId));
      return await this.provisioner.internal('assets', 'POST', '/onboarding', companyId, { personId, joinDate: p.joinDate, roleNames: names.map((n) => n.name) });
    } catch (err) {
      this.log.warn(`Onboarding for ${personId}: ${(err as Error).message}`);
      return null;
    }
  }
}
