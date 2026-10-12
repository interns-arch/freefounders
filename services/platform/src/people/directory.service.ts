import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, departments, people, personApps } from '../db/schema';
import { internalUrl, ProvisionClient } from '../provision/provision.client';

export const departmentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  active: z.boolean().optional(),
});

/** What an app reports when a company is brought into the directory (first sync of an existing company). */
export interface AppPeopleExport {
  departments: Array<{ code: string; name: string; active?: boolean }>;
  people: Array<{ personId: string; departmentCode?: string | null; designation?: string | null; reportsTo?: string | null; joinDate?: string | null }>;
}

/** "Sales & Marketing" -> "sales-marketing" (at most 20 characters: the apps' department code length). */
export function departmentCode(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
      .replace(/-+$/, '') || 'dept'
  );
}

/**
 * The People directory (PLAN.md §17.1): one department list per company and each person's department,
 * designation, reports-to and join date. The Platform owns it; every app gets a copy of the people it has.
 */
@Injectable()
export class DirectoryService {
  private readonly log = new Logger('Directory');

  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
  ) {}

  // ─── departments ─────────────────────────────────────────────────────────

  async listDepartments(caller: Caller) {
    const rows = await this.dbs.db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        active: departments.active,
        people: sql<number>`(select count(*)::int from ${people} where ${people.departmentId} = ${departments.id} and ${people.status} = 'active')`,
      })
      .from(departments)
      .where(eq(departments.companyId, caller.companyId))
      .orderBy(asc(departments.name));
    return rows;
  }

  private async freeCode(companyId: string, name: string): Promise<string> {
    const base = departmentCode(name);
    const taken = new Set(
      (await this.dbs.db.select({ code: departments.code }).from(departments).where(eq(departments.companyId, companyId))).map((r) => r.code),
    );
    let code = base;
    for (let n = 2; taken.has(code); n++) code = `${base.slice(0, 20 - String(n).length - 1)}-${n}`;
    return code;
  }

  async createDepartment(caller: Caller, input: z.infer<typeof departmentSchema>) {
    const [clash] = await this.dbs.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.companyId, caller.companyId), sql`lower(${departments.name}) = lower(${input.name})`))
      .limit(1);
    if (clash) throw badRequest('A department with this name already exists', { name: 'Already exists' });
    const [d] = await this.dbs.db
      .insert(departments)
      .values({ companyId: caller.companyId, name: input.name, code: await this.freeCode(caller.companyId, input.name), active: input.active ?? true })
      .returning();
    const sync = await this.push(caller.companyId);
    return { ...d, sync };
  }

  /** Rename or (de)activate. The code never changes, so the apps keep recognising it. */
  async updateDepartment(caller: Caller, id: string, input: Partial<z.infer<typeof departmentSchema>>) {
    const [d] = await this.dbs.db
      .update(departments)
      .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.active !== undefined ? { active: input.active } : {}), updatedAt: new Date() })
      .where(and(eq(departments.id, id), eq(departments.companyId, caller.companyId)))
      .returning();
    if (!d) throw notFound('Department');
    const sync = await this.push(caller.companyId);
    return { ...d, sync };
  }

  // ─── checks used by People ─────────────────────────────────────────────────

  async assertDepartment(companyId: string, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const [d] = await this.dbs.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)))
      .limit(1);
    if (!d) throw badRequest('Unknown department', { departmentId: 'Unknown department' });
  }

  /** The manager must be someone else in the company, and the chain must not loop back to this person. */
  async assertReportsTo(companyId: string, personId: string | null, managerId: string | null | undefined) {
    if (!managerId) return;
    if (managerId === personId) throw badRequest('A person cannot report to themselves', { reportsTo: 'Choose someone else' });
    const seen = new Set<string>();
    let current: string | null = managerId;
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      const [row] = await this.dbs.db
        .select({ companyId: people.companyId, reportsTo: people.reportsTo })
        .from(people)
        .where(eq(people.id, current))
        .limit(1);
      if (!row || row.companyId !== companyId) throw badRequest('Unknown manager', { reportsTo: 'Unknown person' });
      if (personId && row.reportsTo === personId) {
        throw badRequest('That would make a loop: this person’s manager reports to them', { reportsTo: 'Makes a loop' });
      }
      current = row.reportsTo;
    }
  }

  // ─── sync to the apps ────────────────────────────────────────────────────

  private connected(enabled: string[]): AppKey[] {
    return enabled.filter((a): a is AppKey => (APPS as readonly string[]).includes(a) && !!internalUrl(a as AppKey));
  }

  /**
   * Sends the department list and every person's directory fields (only the people who have that app) to each app.
   * Never throws. An app ahead of the Platform (e.g. a restored backup) makes us move past its version and resend once.
   */
  async push(companyId: string, { retried = false } = {}): Promise<Record<string, string>> {
    const db = this.dbs.db;
    const [c] = await db
      .update(companies)
      .set({ peopleVersion: sql`${companies.peopleVersion} + 1` })
      .where(eq(companies.id, companyId))
      .returning({ version: companies.peopleVersion, apps: companies.enabledApps });
    if (!c) return {};
    const depts = await db.select().from(departments).where(eq(departments.companyId, companyId));
    const codeOf = new Map(depts.map((d) => [d.id, d.code]));
    const result: Record<string, string> = {};
    let ahead = 0;
    for (const app of this.connected(c.apps)) {
      const rows = await db
        .select({ person: people })
        .from(personApps)
        .innerJoin(people, eq(people.id, personApps.personId))
        .where(and(eq(people.companyId, companyId), eq(personApps.app, app)));
      try {
        const res = await this.provisioner.pushPeople(app, companyId, {
          version: c.version,
          departments: depts.map((d) => ({ code: d.code, name: d.name, active: d.active })),
          people: rows.map(({ person: p }) => ({
            personId: p.id,
            status: p.status,
            departmentCode: p.departmentId ? (codeOf.get(p.departmentId) ?? null) : null,
            designation: p.designation,
            reportsTo: p.reportsTo,
            joinDate: p.joinDate,
            // Attendance lists, reports and the attendance import match on it (PLAN.md §19.15).
            employeeCode: p.employeeCode,
          })),
        });
        result[app] = res.applied ? 'ok' : 'stale';
        if (!res.applied && typeof res.version === 'number') ahead = Math.max(ahead, res.version);
      } catch (err) {
        result[app] = `failed: ${(err as Error).message}`;
        this.log.error(`People sync to ${app} failed for company ${companyId}: ${(err as Error).message}`);
      }
    }
    if (ahead && !retried) {
      await db.update(companies).set({ peopleVersion: sql`greatest(${companies.peopleVersion}, ${ahead})` }).where(eq(companies.id, companyId));
      return this.push(companyId, { retried: true });
    }
    return result;
  }

  /**
   * First time only (a company with no departments yet): brings in the apps' departments and each person's department,
   * reports-to, designation and join date, so nothing changes for an existing company. Tasks first (it routes approvals by
   * reports-to), then Assets fills what is still empty. Returns false when the company already had departments.
   */
  async importFromApps(companyId: string): Promise<boolean> {
    const db = this.dbs.db;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(departments).where(eq(departments.companyId, companyId));
    if (n > 0) return false;
    const [c] = await db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, companyId));
    const order = this.connected(c?.apps ?? []).sort((a, b) => (a === 'tasks' ? 0 : 1) - (b === 'tasks' ? 0 : 1));
    const exports: AppPeopleExport[] = [];
    for (const app of order) {
      try {
        exports.push(await this.provisioner.exportPeople(app, companyId));
      } catch (err) {
        this.log.warn(`People export from ${app}: ${(err as Error).message}`);
      }
    }
    if (!exports.length) return false;
    await db.transaction(async (tx) => {
      const byCode = new Map<string, string>();
      const names = new Set<string>();
      for (const e of exports) {
        for (const d of e.departments) {
          const code = departmentCode(d.code || d.name);
          if (byCode.has(code) || names.has(d.name.toLowerCase())) continue;
          const [row] = await tx.insert(departments).values({ companyId, code, name: d.name.slice(0, 60), active: d.active ?? true }).returning({ id: departments.id });
          byCode.set(code, row.id);
          names.add(d.name.toLowerCase());
        }
      }
      const ids = [...new Set(exports.flatMap((e) => e.people.map((p) => p.personId)))];
      const mine = ids.length
        ? await tx.select().from(people).where(and(eq(people.companyId, companyId), inArray(people.id, ids)))
        : [];
      const valid = new Set(mine.map((p) => p.id));
      for (const p of mine) {
        const set: Partial<typeof people.$inferInsert> = {};
        for (const e of exports) {
          const x = e.people.find((q) => q.personId === p.id);
          if (!x) continue;
          const dept = x.departmentCode ? byCode.get(departmentCode(x.departmentCode)) : undefined;
          if (!p.departmentId && !set.departmentId && dept) set.departmentId = dept;
          if (!p.reportsTo && !set.reportsTo && x.reportsTo && valid.has(x.reportsTo) && x.reportsTo !== p.id) set.reportsTo = x.reportsTo;
          if (!p.designation && !set.designation && x.designation) set.designation = x.designation.slice(0, 80);
          if (!p.joinDate && !set.joinDate && x.joinDate) set.joinDate = x.joinDate;
        }
        if (Object.keys(set).length) await tx.update(people).set(set).where(eq(people.id, p.id));
      }
    });
    return true;
  }

  /** Brings a company in (first time) and sends everyone's directory to every app. */
  async sync(companyId: string) {
    const imported = await this.importFromApps(companyId);
    return { imported, push: await this.push(companyId) };
  }
}
