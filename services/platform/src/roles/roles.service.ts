import { ModuleRef } from '@nestjs/core';
import { DirectoryService } from '../people/directory.service';
import { FlowsService } from '../people/flows.service';
import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, people, personApps, personRoles, type RoleDuty, roleGrants, roles } from '../db/schema';
import { type AppCatalogue, internalUrl, ProvisionClient, type UpgradeRule } from '../provision/provision.client';
import { PLATFORM_APP, PLATFORM_CATALOGUE } from './platform-permissions';

/**
 * The two roles every company starts with. Their codes are new, so they never collide with an app's own roles.
 * Only Super Admin (the Owner role) is locked: it always has every permission, new ones included (PLAN.md §19.19).
 */
export const SUPER_ADMIN = {
  code: 'ff_super_admin',
  name: 'Super Admin',
  description: 'Everything in every app, always (new permissions included). Cannot be edited, so the company can never lock itself out.',
};
export const ADMIN = { code: 'ff_admin', name: 'Admin', description: 'Starts with everything except the Owner-only powers. Edit it like any role.' };

/** Apps a role can have permissions in: the company's apps, plus the Admin workspace itself. */
export const GRANT_APPS = [...APPS, PLATFORM_APP] as const;
export type GrantApp = (typeof GRANT_APPS)[number];

const grantSchema = z.object({
  app: z.enum(GRANT_APPS),
  permission: z.string().trim().min(1).max(60),
  scope: z.string().trim().max(20).optional().default(''),
});
export const dutySchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1, 'Give the duty a title').max(150),
    description: z.string().trim().max(1000).nullable().optional(),
    steps: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'once']),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    monthDay: z.number().int().min(1).max(28).nullable().optional(),
  })
  .refine((d) => d.frequency !== 'weekly' || d.weekday != null, { message: 'Choose the day of the week', path: ['weekday'] })
  .refine((d) => d.frequency !== 'monthly' || d.monthDay != null, { message: 'Choose the day of the month', path: ['monthDay'] });

/** Keeps each duty's id (Tasks remembers what it already created by it); new duties get one. */
function withIds(duties: z.infer<typeof dutySchema>[]): RoleDuty[] {
  return duties.map((d) => ({
    id: d.id ?? randomUUID(),
    title: d.title,
    description: d.description ?? null,
    steps: d.steps ?? [],
    frequency: d.frequency,
    weekday: d.frequency === 'weekly' ? (d.weekday ?? 0) : null,
    monthDay: d.frequency === 'monthly' ? (d.monthDay ?? 1) : null,
  }));
}

export const roleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(300).nullable().optional(),
  colour: z.string().trim().max(20).nullable().optional(),
  level: z.number().int().min(1).max(3).optional().default(1),
  grants: z.array(grantSchema).max(500).optional().default([]),
  duties: z.array(dutySchema).max(50).optional(),
});
/** PATCH: only what is sent changes (no defaults, so a partial body never resets the level or the permissions). */
export const roleUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  colour: z.string().trim().max(20).nullable().optional(),
  level: z.number().int().min(1).max(3).optional(),
  grants: z.array(grantSchema).max(500).optional(),
  duties: z.array(dutySchema).max(50).optional(),
});
export const personRolesSchema = z.object({ roleIds: z.array(z.string().uuid()).max(50) });
export type RoleInput = z.infer<typeof roleInputSchema>;

type Grant = { app: GrantApp; permission: string; scope: string };
type Catalogue = AppCatalogue & { app: GrantApp };
const CATALOGUE_TTL_MS = 10 * 60_000;

const ruleMatches = (rule: UpgradeRule, had: Map<string, string>, level: number) => {
  if (rule.everyone) return true;
  if (rule.minLevel != null) return level >= rule.minLevel;
  if (rule.from) return had.has(rule.from) && (!rule.fromScopes?.length || rule.fromScopes.includes(had.get(rule.from)!));
  return false;
};

/**
 * One role's grants in one app, saved under an older catalogue -> the same powers in this one (PLAN.md §19.19). Generic:
 * the app publishes the rules. Roles with no permission in the app stay empty there; retired permissions are replaced.
 */
export function upgradeGrants(grants: Map<string, string>, level: number, cat: AppCatalogue): Map<string, string> {
  if (!grants.size) return new Map(grants);
  const byKey = new Map(cat.permissions.map((p) => [p.key, p]));
  const had = new Map(
    [...grants].map(([k, v]) => {
      const p = byKey.get(k);
      return [k, p?.scopes && !p.scopes.includes(v) && p.legacyScope ? p.legacyScope : v] as const;
    }),
  );
  const retired = new Set(cat.retired ?? []);
  const out = new Map([...had].filter(([k]) => !retired.has(k)));
  const rank = (s: string) => cat.scopes.indexOf(s);
  for (const p of cat.permissions) {
    for (const rule of p.upgrade ?? []) {
      if (!ruleMatches(rule, had, level)) continue;
      if (!p.scopes) {
        out.set(p.key, '');
        continue;
      }
      const scope = rule.scope && p.scopes.includes(rule.scope) ? rule.scope : p.scopes[0];
      const now = out.get(p.key);
      out.set(p.key, now !== undefined && rank(now) >= rank(scope) ? now : scope);
    }
  }
  return out;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50) || 'role';

/**
 * The role builder (PLAN.md §15): a company's roles, which permissions each has in each app, and who holds them.
 * The Platform is the source of truth; every change is pushed to the apps, which check permissions locally.
 */
@Injectable()
export class RolesService {
  private readonly log = new Logger('Roles');
  private readonly catalogues = new Map<string, { at: number; data: AppCatalogue }>();

  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
    private readonly auth: AuthService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ─── catalogue ──────────────────────────────────────────────────────────

  private async enabledApps(companyId: string): Promise<AppKey[]> {
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return (c?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
  }

  /**
   * What each of the company's apps offers, read from the apps themselves (cached for a few minutes), then the Admin
   * workspace's own permissions (PLAN.md §19.19).
   */
  async catalogue(companyId: string): Promise<Catalogue[]> {
    const out: Catalogue[] = [];
    for (const app of await this.enabledApps(companyId)) {
      if (!internalUrl(app)) continue;
      const hit = this.catalogues.get(app);
      if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) {
        out.push({ ...hit.data, app });
        continue;
      }
      const data = await this.provisioner.permissions(app, companyId);
      this.catalogues.set(app, { at: Date.now(), data });
      out.push({ ...data, app });
    }
    out.push({ ...PLATFORM_CATALOGUE, app: PLATFORM_APP });
    return out;
  }

  /**
   * Keeps the company's roles in step with the catalogues (PLAN.md §19.19): roles saved under an older catalogue
   * version get the same powers in the new one, once; the Owner role always has every permission. Never throws (an app
   * that cannot be reached is tried again next time).
   */
  async ensureUpgraded(companyId: string): Promise<Record<string, number>> {
    const db = this.dbs.db;
    try {
      const cat = await this.catalogue(companyId);
      const done = await db.transaction(async (tx) => {
        const [c] = await tx.select({ upgrades: companies.accessUpgrades }).from(companies).where(eq(companies.id, companyId)).for('update');
        const applied: Record<string, number> = { ...(c?.upgrades ?? {}) };
        const todo = cat.filter((a) => (a.version ?? 1) > (applied[a.app] ?? 1));
        if (todo.length) {
          const roleRows = await tx.select({ id: roles.id, level: roles.level }).from(roles).where(eq(roles.companyId, companyId));
          const all = roleRows.length ? await tx.select().from(roleGrants).where(inArray(roleGrants.roleId, roleRows.map((r) => r.id))) : [];
          for (const role of roleRows) {
            for (const app of todo) {
              const mine = new Map(all.filter((g) => g.roleId === role.id && g.app === app.app).map((g) => [g.permission, g.scope]));
              const next = upgradeGrants(mine, role.level, app);
              if (next.size === mine.size && [...next].every(([k, v]) => mine.get(k) === v)) continue;
              await tx.delete(roleGrants).where(and(eq(roleGrants.roleId, role.id), eq(roleGrants.app, app.app)));
              if (next.size) await tx.insert(roleGrants).values([...next].map(([permission, scope]) => ({ roleId: role.id, app: app.app, permission, scope })));
            }
          }
          for (const app of todo) applied[app.app] = app.version ?? 1;
          await tx.update(companies).set({ accessUpgrades: applied }).where(eq(companies.id, companyId));
          this.log.log(`Roles of company ${companyId} upgraded to ${todo.map((a) => `${a.app} v${a.version}`).join(', ')}`);
        }
        // The Owner role: every permission at its widest scope, whatever the apps offer today.
        const [owner] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, companyId), eq(roles.code, SUPER_ADMIN.code))).limit(1);
        if (owner) {
          const want = this.systemGrants(cat, true);
          const have = await tx.select().from(roleGrants).where(eq(roleGrants.roleId, owner.id));
          const same = want.length === have.length && want.every((w) => have.some((h) => h.app === w.app && h.permission === w.permission && h.scope === w.scope));
          if (!same) {
            await tx.delete(roleGrants).where(eq(roleGrants.roleId, owner.id));
            if (want.length) await tx.insert(roleGrants).values(want.map((g) => ({ roleId: owner.id, ...g })));
          }
        }
        return applied;
      });
      return Object.fromEntries(cat.map((a) => [a.app, done[a.app] ?? 1]));
    } catch (err) {
      this.log.warn(`Role catalogue check skipped for company ${companyId}: ${(err as Error).message}`);
      const [c] = await db.select({ upgrades: companies.accessUpgrades }).from(companies).where(eq(companies.id, companyId)).limit(1);
      return { ...(c?.upgrades ?? {}) };
    }
  }

  private async validGrants(companyId: string, grants: Grant[]): Promise<Grant[]> {
    if (!grants.length) return [];
    const cat = await this.catalogue(companyId);
    const seen = new Set<string>();
    const out: Grant[] = [];
    for (const g of grants) {
      const app = cat.find((c) => c.app === g.app);
      if (!app) throw badRequest(`${g.app} is not part of this company's plan`);
      const p = app.permissions.find((x) => x.key === g.permission);
      if (!p) throw badRequest(`${g.app} has no permission "${g.permission}"`);
      const scope = g.scope ?? '';
      if (p.scopes ? !p.scopes.includes(scope) : scope !== '') throw badRequest(`"${p.label}" cannot have scope "${scope || 'none'}"`);
      const key = `${g.app}:${g.permission}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ app: g.app, permission: g.permission, scope });
    }
    return out;
  }

  /** Every permission at its widest scope (the Owner role); without the Owner-only ones for the starting Admin role. */
  private systemGrants(cat: Catalogue[], superAdmin: boolean): Grant[] {
    return cat.flatMap((c) =>
      c.permissions
        .filter((p) => superAdmin || !p.superAdminOnly)
        .map((p) => ({ app: c.app, permission: p.key, scope: p.scopes ? p.scopes[p.scopes.length - 1] : '' })),
    );
  }

  // ─── roles ──────────────────────────────────────────────────────────────

  async list(caller: Caller, includeArchived = false) {
    await this.ensureUpgraded(caller.companyId);
    const db = this.dbs.db;
    const rows = await db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
        colour: roles.colour,
        level: roles.level,
        system: roles.system,
        archived: roles.archived,
        duties: roles.duties,
        people: sql<number>`(select count(*)::int from ${personRoles} pr join ${people} p on p.id = pr.person_id where pr.role_id = ${roles.id} and p.status = 'active')`,
      })
      .from(roles)
      .where(and(eq(roles.companyId, caller.companyId), includeArchived ? sql`true` : eq(roles.archived, false)))
      .orderBy(sql`${roles.system} desc`, asc(roles.name));
    const grants = rows.length
      ? await db.select().from(roleGrants).where(inArray(roleGrants.roleId, rows.map((r) => r.id)))
      : [];
    return rows.map((r) => ({
      ...r,
      grants: grants.filter((g) => g.roleId === r.id).map(({ app, permission, scope }) => ({ app, permission, scope })),
    }));
  }

  private async getRole(companyId: string, id: string) {
    const [role] = await this.dbs.db.select().from(roles).where(and(eq(roles.id, id), eq(roles.companyId, companyId))).limit(1);
    if (!role) throw notFound('Role');
    return role;
  }

  private async freeCode(companyId: string, name: string): Promise<string> {
    const base = slug(name);
    for (let n = 1; ; n++) {
      const code = n === 1 ? base : `${base}_${n}`;
      const [taken] = await this.dbs.db.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, companyId), eq(roles.code, code))).limit(1);
      if (!taken) return code;
    }
  }

  private async assertNameFree(companyId: string, name: string, exceptId?: string) {
    const [taken] = await this.dbs.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, companyId), sql`lower(${roles.name}) = lower(${name})`, exceptId ? sql`${roles.id} <> ${exceptId}` : sql`true`))
      .limit(1);
    if (taken) throw new ConflictException(`There is already a role called "${name}"`);
  }

  async create(caller: Caller, input: RoleInput) {
    await this.assertNameFree(caller.companyId, input.name);
    const grants = await this.validGrants(caller.companyId, input.grants as Grant[]);
    const id = await this.dbs.db.transaction(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ companyId: caller.companyId, code: await this.freeCode(caller.companyId, input.name), name: input.name, description: input.description ?? null, colour: input.colour ?? null, level: input.level, duties: withIds(input.duties ?? []) })
        .returning({ id: roles.id });
      if (grants.length) await tx.insert(roleGrants).values(grants.map((g) => ({ roleId: role.id, ...g })));
      return role.id;
    });
    const sync = await this.push(caller.companyId);
    return { ...(await this.list(caller)).find((r) => r.id === id), sync };
  }

  async update(caller: Caller, id: string, input: Partial<RoleInput>) {
    const role = await this.getRole(caller.companyId, id);
    if (role.system) throw new ForbiddenException(`${role.name} is locked: it always has every permission`);
    if (role.archived) throw badRequest('This role is archived');
    if (input.name) await this.assertNameFree(caller.companyId, input.name, id);
    const grants = input.grants ? await this.validGrants(caller.companyId, input.grants as Grant[]) : null;
    await this.dbs.db.transaction(async (tx) => {
      await tx
        .update(roles)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.colour !== undefined ? { colour: input.colour } : {}),
          ...(input.level ? { level: input.level } : {}),
          ...(input.duties ? { duties: withIds(input.duties) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(roles.id, id));
      if (grants) {
        await tx.delete(roleGrants).where(eq(roleGrants.roleId, id));
        if (grants.length) await tx.insert(roleGrants).values(grants.map((g) => ({ roleId: id, ...g })));
      }
    });
    // A role may now cover more or fewer apps: the people holding it gain or lose those apps.
    for (const personId of await this.holders(id)) await this.applyApps(caller.companyId, personId);
    const sync = await this.push(caller.companyId);
    return { ...(await this.list(caller)).find((r) => r.id === id), sync };
  }

  async duplicate(caller: Caller, id: string) {
    const role = await this.getRole(caller.companyId, id);
    const grants = await this.dbs.db.select().from(roleGrants).where(eq(roleGrants.roleId, id));
    let name = `${role.name} (copy)`;
    for (let n = 2; ; n++) {
      const [taken] = await this.dbs.db.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, caller.companyId), sql`lower(${roles.name}) = lower(${name})`)).limit(1);
      if (!taken) break;
      name = `${role.name} (copy ${n})`;
    }
    return this.create(caller, {
      name,
      description: role.description,
      colour: role.colour,
      level: role.system ? 3 : role.level,
      grants: grants.map(({ app, permission, scope }) => ({ app: app as AppKey, permission, scope })),
      duties: (role.duties ?? []).map(({ id: _id, ...d }) => ({ ...d, steps: d.steps ?? [] })), // the copy's duties are its own
    });
  }

  /** Archives a role: nobody holds it any more (they lose apps it alone gave them); history keeps its name. */
  async archive(caller: Caller, id: string) {
    const role = await this.getRole(caller.companyId, id);
    if (role.system) throw new ForbiddenException(`${role.name} is locked: the company always keeps it`);
    const holders = await this.holders(id);
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(roles).set({ archived: true, updatedAt: new Date() }).where(eq(roles.id, id));
      await tx.delete(personRoles).where(eq(personRoles.roleId, id));
    });
    for (const personId of holders) await this.applyApps(caller.companyId, personId);
    const sync = await this.push(caller.companyId);
    return { ok: true, sync };
  }

  private async holders(roleId: string): Promise<string[]> {
    return (await this.dbs.db.select({ id: personRoles.personId }).from(personRoles).where(eq(personRoles.roleId, roleId))).map((r) => r.id);
  }

  // ─── people's roles ─────────────────────────────────────────────────────

  async rolesOf(companyId: string, personIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!personIds.length) return out;
    const rows = await this.dbs.db
      .select({ personId: personRoles.personId, roleId: personRoles.roleId })
      .from(personRoles)
      .innerJoin(roles, eq(roles.id, personRoles.roleId))
      .where(and(inArray(personRoles.personId, personIds), eq(roles.companyId, companyId), eq(roles.archived, false)));
    for (const r of rows) out.set(r.personId, [...(out.get(r.personId) ?? []), r.roleId]);
    return out;
  }

  /** Gives a person exactly these roles; their apps follow (opened or closed), and the apps get the new roles. */
  async setPersonRoles(caller: Caller, personId: string, roleIds: string[]) {
    const db = this.dbs.db;
    const [person] = await db.select().from(people).where(and(eq(people.id, personId), eq(people.companyId, caller.companyId))).limit(1);
    if (!person) throw notFound('Person');
    const wanted = [...new Set(roleIds)];
    const found = wanted.length
      ? await db.select().from(roles).where(and(inArray(roles.id, wanted), eq(roles.companyId, caller.companyId), eq(roles.archived, false)))
      : [];
    if (found.length !== wanted.length) throw badRequest('Unknown or archived role');
    const current = (await this.rolesOf(caller.companyId, [personId])).get(personId) ?? [];
    const superRole = (await db.select().from(roles).where(and(eq(roles.companyId, caller.companyId), eq(roles.code, SUPER_ADMIN.code))).limit(1))[0];
    if (superRole && current.includes(superRole.id) !== wanted.includes(superRole.id) && caller.role !== 'owner') {
      throw new ForbiddenException('Only an owner can give or take the Super Admin role');
    }
    await db.transaction(async (tx) => {
      await tx.delete(personRoles).where(eq(personRoles.personId, personId));
      if (wanted.length) await tx.insert(personRoles).values(wanted.map((roleId) => ({ personId, roleId })));
    });
    const apps = await this.applyApps(caller.companyId, personId);
    const sync = await this.push(caller.companyId);
    // A newly opened app needs the person's department and manager too.
    await this.moduleRef.get(DirectoryService, { strict: false }).push(caller.companyId);
    return { roleIds: wanted, apps, sync };
  }

  /**
   * A person can open an app when one of their roles has a permission in it (and the company's plan includes it).
   * Opens the apps they gained (the app finds or creates their user) and closes the ones they lost.
   */
  private async applyApps(companyId: string, personId: string, { close = true } = {}): Promise<AppKey[]> {
    const db = this.dbs.db;
    const enabled = await this.enabledApps(companyId);
    const fromRoles = await db
      .selectDistinct({ app: roleGrants.app })
      .from(personRoles)
      .innerJoin(roles, eq(roles.id, personRoles.roleId))
      .innerJoin(roleGrants, eq(roleGrants.roleId, roles.id))
      .where(and(eq(personRoles.personId, personId), eq(roles.archived, false)));
    const needed = fromRoles.map((r) => r.app as AppKey).filter((a) => enabled.includes(a));
    const have = (await db.select({ app: personApps.app }).from(personApps).where(eq(personApps.personId, personId))).map((r) => r.app as AppKey);
    const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
    const opened: AppKey[] = [];
    for (const app of needed.filter((a) => !have.includes(a))) {
      if (!internalUrl(app)) continue;
      const localUserId = await this.provisioner.provision(app, companyId, {
        personId,
        fullName: person.fullName,
        email: person.email,
        employeeCode: person.employeeCode,
        mobile: person.mobile,
        username: null,
        platformRole: person.platformRole,
      });
      await db.insert(personApps).values({ personId, app, localUserId }).onConflictDoUpdate({ target: [personApps.personId, personApps.app], set: { localUserId } });
      if (app === 'assets') opened.push(app);
    }
    if (opened.length) {
      // Roles first, so the onboarding kit can follow the person's role (PLAN.md §17.4).
      await this.push(companyId);
      await this.moduleRef.get(FlowsService, { strict: false }).onboardIfJoining(companyId, personId);
    }
    const lost = close ? have.filter((a) => !needed.includes(a)) : [];
    if (lost.length) {
      await db.delete(personApps).where(and(eq(personApps.personId, personId), inArray(personApps.app, lost)));
      await this.auth.revokeAll(personId); // the next token no longer lists those apps
    }
    return needed;
  }

  // ─── sync to the apps ───────────────────────────────────────────────────

  /**
   * Sends the company's full role set, and everyone's roles, to every connected app. Never throws: a failure is
   * reported in the result and logged; `npm run company -- sync` sends everything again.
   */
  async push(companyId: string, { retried = false } = {}): Promise<Record<string, string>> {
    const db = this.dbs.db;
    // Which catalogue version the grants below are written in, per app (an app upgrades older ones itself).
    const catalogueVersions = await this.ensureUpgraded(companyId);
    const [c] = await db
      .update(companies)
      .set({ accessVersion: sql`${companies.accessVersion} + 1` })
      .where(eq(companies.id, companyId))
      .returning({ version: companies.accessVersion, apps: companies.enabledApps });
    let ahead = 0;
    const roleRows = await db.select().from(roles).where(and(eq(roles.companyId, companyId), eq(roles.archived, false)));
    const grants = roleRows.length ? await db.select().from(roleGrants).where(inArray(roleGrants.roleId, roleRows.map((r) => r.id))) : [];
    const payloadRoles = roleRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      colour: r.colour,
      level: r.level,
      system: r.system,
      grants: grants.filter((g) => g.roleId === r.id).map(({ app, permission, scope }) => ({ app, permission, scope })),
      duties: r.duties ?? [],
    }));
    const result: Record<string, string> = {};
    for (const app of (c?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a))) {
      if (!internalUrl(app)) continue;
      const holders = await db.select({ personId: personApps.personId }).from(personApps).innerJoin(people, eq(people.id, personApps.personId)).where(and(eq(people.companyId, companyId), eq(personApps.app, app)));
      const byPerson = await this.rolesOf(companyId, holders.map((h) => h.personId));
      try {
        const res = await this.provisioner.pushAccess(app, companyId, {
          version: c.version,
          catalogueVersions,
          roles: payloadRoles,
          people: holders.map((h) => ({ personId: h.personId, roleIds: byPerson.get(h.personId) ?? [] })),
        });
        result[app] = res.applied ? 'ok' : 'stale';
        if (!res.applied && typeof res.version === 'number') ahead = Math.max(ahead, res.version);
        if (res.problems?.length) this.log.warn(`${app}: ${res.problems.join('; ')}`);
      } catch (err) {
        result[app] = `failed: ${(err as Error).message}`;
        this.log.error(`Role sync to ${app} failed for company ${companyId}: ${(err as Error).message}`);
      }
    }
    if (ahead && !retried) {
      // An app has a newer version than ours (e.g. the Platform database was restored from a backup). The Platform is
      // the source of truth: move past the app's version and send everything again, once.
      this.log.warn(`Role sync: an app is at version ${ahead}, ahead of the Platform (${c.version}) for company ${companyId}; resending`);
      await db.update(companies).set({ accessVersion: sql`greatest(${companies.accessVersion}, ${ahead})` }).where(eq(companies.id, companyId));
      return this.push(companyId, { retried: true });
    }
    return result;
  }

  // ─── bringing a company into the role builder ───────────────────────────

  /**
   * First time only (a company with no roles yet): the locked Super Admin and Admin roles, plus every role the apps
   * already have, each kept to its own app so nobody's access changes. People keep the roles they had in each app;
   * owners also get Super Admin. Returns false when the company already had roles.
   */
  async importFromApps(companyId: string): Promise<boolean> {
    const db = this.dbs.db;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(roles).where(eq(roles.companyId, companyId));
    if (n > 0) return false;
    const cat = await this.catalogue(companyId);
    const appExports: Array<{ app: AppKey; data: Awaited<ReturnType<ProvisionClient['exportAccess']>> }> = [];
    for (const c of cat) {
      if (c.app !== PLATFORM_APP) appExports.push({ app: c.app, data: await this.provisioner.exportAccess(c.app, companyId) });
    }

    await db.transaction(async (tx) => {
      const used = new Set<string>([SUPER_ADMIN.name.toLowerCase(), ADMIN.name.toLowerCase()]);
      // The apps' roles are already in today's catalogues: nothing to upgrade later.
      await tx.update(companies).set({ accessUpgrades: Object.fromEntries(cat.map((a) => [a.app, a.version ?? 1])) }).where(eq(companies.id, companyId));
      const insertRole = async (v: { code: string; name: string; description?: string | null; level: number; system?: boolean }, grants: Grant[]) => {
        const [r] = await tx.insert(roles).values({ companyId, code: v.code, name: v.name, description: v.description ?? null, level: v.level, system: v.system ?? false }).returning({ id: roles.id });
        if (grants.length) await tx.insert(roleGrants).values(grants.map((g) => ({ roleId: r.id, ...g })));
        return r.id;
      };
      const superId = await insertRole({ ...SUPER_ADMIN, level: 3, system: true }, this.systemGrants(cat, true));
      // Admin starts with everything (but the Owner-only powers and the Admin workspace, which the admin access level
      // gives) and is an ordinary role from then on.
      await insertRole({ ...ADMIN, level: 3 }, this.systemGrants(cat, false).filter((g) => g.app !== PLATFORM_APP));

      const roleId = new Map<string, string>(); // `${app}:${local code}` -> platform role id
      for (const { app, data } of appExports) {
        const known = new Set(cat.find((c) => c.app === app)!.permissions.map((p) => p.key));
        for (const r of data.roles.filter((x) => !x.archived)) {
          // Tasks keeps its role names; other apps' roles say which app they are for. Clashes get the app's name.
          let name = app === 'tasks' ? r.name : `${r.name} (${app === 'assets' ? 'Assets' : app})`;
          if (used.has(name.toLowerCase())) name = `${r.name} (${app === 'tasks' ? 'Tasks' : 'Assets'})`;
          used.add(name.toLowerCase());
          const grants = r.grants.filter((g) => known.has(g.permission)).map((g) => ({ app, permission: g.permission, scope: g.scope ?? '' }));
          roleId.set(`${app}:${r.code}`, await insertRole({ code: app === 'tasks' ? r.code : `${app}:${r.code}`, name, description: r.description, level: r.level ?? 1 }, grants));
        }
      }
      // Each app finds its own copy again by code: Tasks by its role code, Assets by `assets:<original name>`.
      const assigned = new Map<string, Set<string>>();
      for (const { app, data } of appExports) {
        for (const p of data.people) {
          for (const code of p.roles) {
            const id = roleId.get(`${app}:${code}`);
            if (id) assigned.set(p.personId, (assigned.get(p.personId) ?? new Set()).add(id));
          }
        }
      }
      const owners = await tx.select({ id: people.id }).from(people).where(and(eq(people.companyId, companyId), eq(people.platformRole, 'owner')));
      for (const o of owners) assigned.set(o.id, (assigned.get(o.id) ?? new Set()).add(superId));
      const inCompany = new Set((await tx.select({ id: people.id }).from(people).where(eq(people.companyId, companyId))).map((p) => p.id));
      const rows = [...assigned].filter(([personId]) => inCompany.has(personId)).flatMap(([personId, ids]) => [...ids].map((roleId) => ({ personId, roleId })));
      if (rows.length) await tx.insert(personRoles).values(rows).onConflictDoNothing();
    });
    return true;
  }

  /** Brings the company into the role builder if needed, then sends the apps everything. */
  async sync(companyId: string) {
    const imported = await this.importFromApps(companyId);
    if (imported) {
      // People whose roles reach an app they cannot open yet (e.g. a new company's owner) get it; nobody loses one here.
      const holders = await this.dbs.db
        .selectDistinct({ id: personRoles.personId })
        .from(personRoles)
        .innerJoin(people, eq(people.id, personRoles.personId))
        .where(eq(people.companyId, companyId));
      for (const h of holders) await this.applyApps(companyId, h.id, { close: false });
    }
    return { imported, push: await this.push(companyId) };
  }
}
