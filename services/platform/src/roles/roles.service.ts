import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, people, personApps, personRoles, roleGrants, roles } from '../db/schema';
import { type AppCatalogue, internalUrl, ProvisionClient } from '../provision/provision.client';

/** The two locked roles every company has. Their codes are new, so they never collide with an app's own roles. */
export const SUPER_ADMIN = { code: 'ff_super_admin', name: 'Super Admin', description: 'Everything in every app. Cannot be edited.' };
export const ADMIN = { code: 'ff_admin', name: 'Admin', description: 'Everything except the few Super Admin-only powers. Cannot be edited.' };

const grantSchema = z.object({
  app: z.enum(APPS),
  permission: z.string().trim().min(1).max(60),
  scope: z.string().trim().max(20).optional().default(''),
});
export const roleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(300).nullable().optional(),
  colour: z.string().trim().max(20).nullable().optional(),
  level: z.number().int().min(1).max(3).optional().default(1),
  grants: z.array(grantSchema).max(500).optional().default([]),
});
export const personRolesSchema = z.object({ roleIds: z.array(z.string().uuid()).max(50) });
export type RoleInput = z.infer<typeof roleInputSchema>;

type Grant = { app: AppKey; permission: string; scope: string };
const CATALOGUE_TTL_MS = 10 * 60_000;

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
  ) {}

  // ─── catalogue ──────────────────────────────────────────────────────────

  private async enabledApps(companyId: string): Promise<AppKey[]> {
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return (c?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
  }

  /** What each of the company's apps offers, read from the apps themselves (cached for a few minutes). */
  async catalogue(companyId: string): Promise<Array<AppCatalogue & { app: AppKey }>> {
    const out: Array<AppCatalogue & { app: AppKey }> = [];
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
    return out;
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

  /** The locked roles' permissions: every permission at its widest scope (Admin: without the Super Admin-only ones). */
  private systemGrants(cat: AppCatalogue[] & Array<{ app: AppKey }>, superAdmin: boolean): Grant[] {
    return cat.flatMap((c) =>
      c.permissions
        .filter((p) => superAdmin || !p.superAdminOnly)
        .map((p) => ({ app: c.app as AppKey, permission: p.key, scope: p.scopes ? p.scopes[p.scopes.length - 1] : '' })),
    );
  }

  // ─── roles ──────────────────────────────────────────────────────────────

  async list(caller: Caller, includeArchived = false) {
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
        .values({ companyId: caller.companyId, code: await this.freeCode(caller.companyId, input.name), name: input.name, description: input.description ?? null, colour: input.colour ?? null, level: input.level })
        .returning({ id: roles.id });
      if (grants.length) await tx.insert(roleGrants).values(grants.map((g) => ({ roleId: role.id, ...g })));
      return role.id;
    });
    const sync = await this.push(caller.companyId);
    return { ...(await this.list(caller)).find((r) => r.id === id), sync };
  }

  async update(caller: Caller, id: string, input: Partial<RoleInput>) {
    const role = await this.getRole(caller.companyId, id);
    if (role.system) throw new ForbiddenException(`${role.name} is a locked role`);
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
    });
  }

  /** Archives a role: nobody holds it any more (they lose apps it alone gave them); history keeps its name. */
  async archive(caller: Caller, id: string) {
    const role = await this.getRole(caller.companyId, id);
    if (role.system) throw new ForbiddenException(`${role.name} is a locked role`);
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
  async push(companyId: string): Promise<Record<string, string>> {
    const db = this.dbs.db;
    const [c] = await db
      .update(companies)
      .set({ accessVersion: sql`${companies.accessVersion} + 1` })
      .where(eq(companies.id, companyId))
      .returning({ version: companies.accessVersion, apps: companies.enabledApps });
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
    }));
    const result: Record<string, string> = {};
    for (const app of (c?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a))) {
      if (!internalUrl(app)) continue;
      const holders = await db.select({ personId: personApps.personId }).from(personApps).innerJoin(people, eq(people.id, personApps.personId)).where(and(eq(people.companyId, companyId), eq(personApps.app, app)));
      const byPerson = await this.rolesOf(companyId, holders.map((h) => h.personId));
      try {
        const res = await this.provisioner.pushAccess(app, companyId, {
          version: c.version,
          roles: payloadRoles,
          people: holders.map((h) => ({ personId: h.personId, roleIds: byPerson.get(h.personId) ?? [] })),
        });
        result[app] = res.applied ? 'ok' : 'stale';
        if (res.problems?.length) this.log.warn(`${app}: ${res.problems.join('; ')}`);
      } catch (err) {
        result[app] = `failed: ${(err as Error).message}`;
        this.log.error(`Role sync to ${app} failed for company ${companyId}: ${(err as Error).message}`);
      }
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
    for (const c of cat) appExports.push({ app: c.app, data: await this.provisioner.exportAccess(c.app, companyId) });

    await db.transaction(async (tx) => {
      const used = new Set<string>([SUPER_ADMIN.name.toLowerCase(), ADMIN.name.toLowerCase()]);
      const insertRole = async (v: { code: string; name: string; description?: string | null; level: number; system?: boolean }, grants: Grant[]) => {
        const [r] = await tx.insert(roles).values({ companyId, code: v.code, name: v.name, description: v.description ?? null, level: v.level, system: v.system ?? false }).returning({ id: roles.id });
        if (grants.length) await tx.insert(roleGrants).values(grants.map((g) => ({ roleId: r.id, ...g })));
        return r.id;
      };
      const superId = await insertRole({ ...SUPER_ADMIN, level: 3, system: true }, this.systemGrants(cat, true));
      await insertRole({ ...ADMIN, level: 3, system: true }, this.systemGrants(cat, false));

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
