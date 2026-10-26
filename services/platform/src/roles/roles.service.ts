import { ModuleRef } from '@nestjs/core';
import { DirectoryService } from '../people/directory.service';
import { FlowsService } from '../people/flows.service';
import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, people, personApps, personRoles, type RoleDuty, roleGrants, roles } from '../db/schema';
import { type AppCatalogue, internalUrl, ProvisionClient, type UpgradeRule } from '../provision/provision.client';
import { heldAccess, PLATFORM_APP, PLATFORM_CATALOGUE } from './platform-permissions';
import { assertSeatFor } from '../billing/seats';

/**
 * Two built-in roles per company (PLAN.md §19.28): Admin and Member. Both are edited like any role (permissions, scopes,
 * duties) but keep their name and level and cannot be archived. The Owner is a mark on the person (`platform_role`
 * owner), carried to the apps by a hidden role that holds every permission (new ones included). A person's extra access
 * and own duties live in a hidden personal role. Neither hidden kind is listed or given like a role.
 */
export const OWNER_ROLE = {
  code: 'ff_owner',
  name: 'Owner (all access)',
  description: 'Hidden: every permission in every app, always. Held by the company owner(s) only.',
};
export const ADMIN = {
  code: 'ff_admin',
  name: 'Admin',
  description: 'Built in: every permission in every app at Company scope, except billing and the Owner-only powers. Edit what it can do; it cannot be deleted.',
};
export const MEMBER = {
  code: 'ff_member',
  name: 'Member',
  description: 'Built in: their own tasks, attendance, leave and salary slip, notices and links, asset requests and tickets. Edit what it can do; it cannot be deleted.',
};
/** The built-in codes: an app or a test may look for them. */
export const BUILT_IN_CODES = [ADMIN.code, MEMBER.code] as const;
export const personalCode = (personId: string) => `ff_person_${personId.replace(/-/g, '')}`;

/** What the Member role starts with (real catalogue keys; a permission the company's apps lack is skipped). */
export const MEMBER_DEFAULTS: Record<string, Array<[string, string]>> = {
  tasks: [
    ['tasks.view', 'own'],
    ['notifications.view', ''],
    ['attendance.punch', ''],
    ['attendance.self', ''],
    ['leave.self', ''],
    ['holidays.view', ''],
    ['payroll.self', ''],
    ['notices.view', ''],
    ['links.view', ''],
    ['visitors.invite', ''],
  ],
  assets: [
    ['request:create', ''],
    ['ticket:create', ''],
  ],
};
/** Not in the Admin role by default (besides every Owner-only permission): billing stays with the owner. */
const NOT_FOR_ADMIN = new Set(['platform:billing.manage']);

/**
 * The template roles of the old model (removed by §19.28): Tasks' 20 built-in roles (codes = Tasks' role values) and the
 * Assets roles brought in as `assets:<name>`. A role made in the role builder has another code and is kept.
 */
export const TEMPLATE_CODES = new Set([
  'super_admin', 'admin', 'sales_manager', 'sales_executive', 'purchase_manager', 'purchase', 'accounts_manager', 'accounts',
  'it_lead', 'it_team', 'developer_manager', 'developer', 'warehouse_manager', 'warehouse', 'rider', 'housekeeping', 'security',
  'legal', 'hr_executive', 'hr_manager',
]);
export const isTemplateCode = (code: string) => TEMPLATE_CODES.has(code) || code.startsWith('assets:');

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
export const personalAccessSchema = z.object({ grants: z.array(grantSchema).max(500).default([]), duties: z.array(dutySchema).max(50).default([]) });
export type RoleInput = z.infer<typeof roleInputSchema>;

type Grant = { app: GrantApp; permission: string; scope: string };
type Catalogue = AppCatalogue & { app: GrantApp };
const CATALOGUE_TTL_MS = 10 * 60_000;

/** What a person with Manage roles who is not the owner may give (docs/security/platform.md R1). */
type Powers = { level: number; held: Map<string, Set<string>> };
type RoleRow = typeof roles.$inferSelect;
type Tx = Parameters<Parameters<DbService['db']['transaction']>[0]>[0];
const LEVEL_NAMES: Record<number, string> = { 1: 'Member', 2: 'Manager', 3: 'Admin' };
const APP_NAMES: Record<string, string> = { tasks: 'Tasks', assets: 'Assets', [PLATFORM_APP]: 'Admin' };
const levelRole = (level: number) => `${level >= 3 ? 'an' : 'a'} ${LEVEL_NAMES[level] ?? level}-level role`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listed = (items: string[]) => (items.length > 5 ? `${items.slice(0, 5).join('; ')} and ${items.length - 5} more` : items.join('; '));

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
export function upgradeGrants(grants: Map<string, string>, level: number, cat: AppCatalogue, fromVersion = 1): Map<string, string> {
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
      if (fromVersion >= (rule.since ?? 2) || !ruleMatches(rule, had, level)) continue;
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
              const next = upgradeGrants(mine, role.level, app, applied[app.app] ?? 1);
              if (next.size === mine.size && [...next].every(([k, v]) => mine.get(k) === v)) continue;
              await tx.delete(roleGrants).where(and(eq(roleGrants.roleId, role.id), eq(roleGrants.app, app.app)));
              if (next.size) await tx.insert(roleGrants).values([...next].map(([permission, scope]) => ({ roleId: role.id, app: app.app, permission, scope })));
            }
          }
          for (const app of todo) applied[app.app] = app.version ?? 1;
          await tx.update(companies).set({ accessUpgrades: applied }).where(eq(companies.id, companyId));
          this.log.log(`Roles of company ${companyId} upgraded to ${todo.map((a) => `${a.app} v${a.version}`).join(', ')}`);
        }
        // Two built-in roles (PLAN.md §19.28): an older company is converted once; every company keeps Admin, Member
        // and the hidden Owner role (every permission, held by exactly the owners).
        let changed: string[] = [];
        const [m] = await tx.select({ model: companies.rolesModel }).from(companies).where(eq(companies.id, companyId)).limit(1);
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roles).where(eq(roles.companyId, companyId));
        if (n > 0) {
          if ((m?.model ?? 2) < 2) changed = await this.convert(tx, companyId, cat);
          await this.ensureBuiltIns(tx, companyId, cat);
        }
        return { applied, changed };
      });
      // People whose roles changed in the conversion get the apps their new roles reach (nobody loses one here).
      for (const personId of done.changed) {
        try {
          await this.applyApps(companyId, personId, { close: false });
        } catch (err) {
          this.log.warn(`Opening apps for ${personId}: ${(err as Error).message}`);
        }
      }
      return Object.fromEntries(cat.map((a) => [a.app, done.applied[a.app] ?? 1]));
    } catch (err) {
      this.log.warn(`Role catalogue check skipped for company ${companyId}: ${(err as Error).message}`);
      const [c] = await db.select({ upgrades: companies.accessUpgrades }).from(companies).where(eq(companies.id, companyId)).limit(1);
      return { ...(c?.upgrades ?? {}) };
    }
  }

  // ─── the two built-in roles, the Owner role, personal roles (PLAN.md §19.28) ─────

  /** Every permission at its widest scope, except the Owner-only ones and billing. */
  adminGrants(cat: Catalogue[]): Grant[] {
    return this.systemGrants(cat, false).filter((g) => !NOT_FOR_ADMIN.has(`${g.app}:${g.permission}`));
  }

  /** MEMBER_DEFAULTS, limited to what the company's apps offer. */
  memberGrants(cat: Catalogue[]): Grant[] {
    const out: Grant[] = [];
    for (const [app, list] of Object.entries(MEMBER_DEFAULTS)) {
      const c = cat.find((x) => x.app === app);
      if (!c) continue;
      for (const [permission, scope] of list) {
        const p = c.permissions.find((x) => x.key === permission);
        if (!p) continue;
        out.push({ app: c.app, permission, scope: p.scopes ? (p.scopes.includes(scope) ? scope : p.scopes[0]) : '' });
      }
    }
    return out;
  }

  private scopeRank(cat: Catalogue[], g: Grant) {
    return cat.find((c) => c.app === g.app)?.permissions.find((p) => p.key === g.permission)?.scopes?.indexOf(g.scope) ?? -1;
  }

  /** The grants in `extra` that `base` does not already give (or gives at a narrower scope). */
  beyond(cat: Catalogue[], extra: Grant[], base: Grant[]): Grant[] {
    return extra.filter((g) => {
      const b = base.find((x) => x.app === g.app && x.permission === g.permission);
      return !b || this.scopeRank(cat, g) > this.scopeRank(cat, b);
    });
  }

  /** Several grant lists as one: each permission once, at the widest scope any of them gives. */
  union(cat: Catalogue[], lists: Grant[][]): Grant[] {
    const out = new Map<string, Grant>();
    for (const g of lists.flat()) {
      const k = `${g.app}:${g.permission}`;
      const have = out.get(k);
      if (!have || this.scopeRank(cat, g) > this.scopeRank(cat, have)) out.set(k, g);
    }
    return [...out.values()];
  }

  private async setGrants(tx: Tx, roleId: string, grants: Grant[]) {
    await tx.delete(roleGrants).where(eq(roleGrants.roleId, roleId));
    if (grants.length) await tx.insert(roleGrants).values(grants.map((g) => ({ roleId, app: g.app, permission: g.permission, scope: g.scope })));
  }

  /** A built-in name taken by a role someone made: that role is renamed "<name> (custom)" so the built-in can have it. */
  private async freeBuiltInName(tx: Tx, companyId: string, name: string, exceptCode: string) {
    await tx
      .update(roles)
      .set({ name: sql`${roles.name} || ' (custom)'`, updatedAt: new Date() })
      .where(and(eq(roles.companyId, companyId), sql`lower(${roles.name}) = lower(${name})`, sql`${roles.code} <> ${exceptCode}`));
  }

  /**
   * Admin, Member and the hidden Owner role exist (created with their starting permissions when missing); the Owner role
   * always has every permission and is held by exactly the company's owners. Returns the three role ids.
   */
  async ensureBuiltIns(tx: Tx, companyId: string, cat: Catalogue[]) {
    const find = async (code: string) => (await tx.select().from(roles).where(and(eq(roles.companyId, companyId), eq(roles.code, code))).limit(1))[0];
    const make = async (v: { code: string; name: string; description: string }, level: number, kind: 'role' | 'owner', grants: Grant[]) => {
      await this.freeBuiltInName(tx, companyId, v.name, v.code);
      const [r] = await tx.insert(roles).values({ companyId, code: v.code, name: v.name, description: v.description, level, system: true, kind }).returning();
      await this.setGrants(tx, r.id, grants);
      return r;
    };
    const admin = (await find(ADMIN.code)) ?? (await make(ADMIN, 3, 'role', this.adminGrants(cat)));
    const member = (await find(MEMBER.code)) ?? (await make(MEMBER, 1, 'role', this.memberGrants(cat)));
    const owner = (await find(OWNER_ROLE.code)) ?? (await make(OWNER_ROLE, 3, 'owner', this.systemGrants(cat, true)));
    // The Owner role: every permission at its widest scope, whatever the apps offer today.
    const want = this.systemGrants(cat, true);
    const have = await tx.select().from(roleGrants).where(eq(roleGrants.roleId, owner.id));
    const same = want.length === have.length && want.every((w) => have.some((h) => h.app === w.app && h.permission === w.permission && h.scope === w.scope));
    if (!same) await this.setGrants(tx, owner.id, want);
    // Held by the owners, and only by them.
    const owners = (await tx.select({ id: people.id }).from(people).where(and(eq(people.companyId, companyId), eq(people.platformRole, 'owner')))).map((p) => p.id);
    await tx.delete(personRoles).where(and(eq(personRoles.roleId, owner.id), owners.length ? notInArray(personRoles.personId, owners) : sql`true`));
    if (owners.length) await tx.insert(personRoles).values(owners.map((personId) => ({ personId, roleId: owner.id }))).onConflictDoNothing();
    // Built-ins stay built in (an older copy of Admin was an ordinary role).
    if (!admin.system || admin.level !== 3 || admin.kind !== 'role' || admin.archived) {
      await tx.update(roles).set({ system: true, level: 3, kind: 'role', archived: false, updatedAt: new Date() }).where(eq(roles.id, admin.id));
    }
    if (!member.system || member.level !== 1 || member.kind !== 'role' || member.archived) {
      await tx.update(roles).set({ system: true, level: 1, kind: 'role', archived: false, updatedAt: new Date() }).where(eq(roles.id, member.id));
    }
    return { adminId: admin.id, memberId: member.id, ownerId: owner.id };
  }

  /** Non-owners hold the Admin role exactly when their access level is admin (PLAN.md §19.28). */
  async syncLevels(tx: Tx, companyId: string, personIds: string[]) {
    if (!personIds.length) return;
    const holdsAdmin = sql`exists (select 1 from ${personRoles} pr join ${roles} r on r.id = pr.role_id
      where pr.person_id = ${people.id} and r.code = ${ADMIN.code} and r.company_id = ${people.companyId} and not r.archived)`;
    await tx
      .update(people)
      .set({ platformRole: sql`case when ${holdsAdmin} then 'admin' else 'member' end`, updatedAt: new Date() })
      .where(
        and(
          eq(people.companyId, companyId),
          ne(people.platformRole, 'owner'),
          inArray(people.id, personIds),
          sql`${people.platformRole} <> case when ${holdsAdmin} then 'admin' else 'member' end`,
        ),
      );
  }

  /**
   * One-time conversion of a company from the template roles (PLAN.md §19.28). The template roles (Tasks' 20 built-in
   * roles, the Assets roles, the old Super Admin) are archived; their holders get Admin when the role was Admin-level,
   * else Member. People whose access level is admin get Admin; owners get Admin and the Owner role. Roles made in the
   * role builder stay as they are. Returns the people whose roles changed.
   */
  private async convert(tx: Tx, companyId: string, cat: Catalogue[]): Promise<string[]> {
    const all = await tx.select().from(roles).where(eq(roles.companyId, companyId));
    const ownerRole = all.find((r) => r.kind === 'owner' || r.code === 'ff_super_admin');
    if (ownerRole && (ownerRole.kind !== 'owner' || ownerRole.code !== OWNER_ROLE.code)) {
      await tx
        .update(roles)
        .set({ kind: 'owner', code: OWNER_ROLE.code, name: OWNER_ROLE.name, description: OWNER_ROLE.description, system: true, level: 3, archived: false, updatedAt: new Date() })
        .where(eq(roles.id, ownerRole.id));
    }
    // Admin starts again from the full set (it was "everything but the Owner-only powers" already).
    const oldAdmin = all.find((r) => r.code === ADMIN.code);
    if (oldAdmin) {
      await this.freeBuiltInName(tx, companyId, ADMIN.name, ADMIN.code);
      await tx.update(roles).set({ name: ADMIN.name, description: ADMIN.description, system: true, level: 3, kind: 'role', archived: false, updatedAt: new Date() }).where(eq(roles.id, oldAdmin.id));
      await this.setGrants(tx, oldAdmin.id, this.adminGrants(cat));
    }
    const { adminId, memberId } = await this.ensureBuiltIns(tx, companyId, cat);

    const removed = all.filter((r) => r.kind === 'role' && !r.archived && isTemplateCode(r.code));
    const removedIds = removed.map((r) => r.id);
    const watched = [...removedIds, ...(ownerRole ? [ownerRole.id] : [])];
    const held = watched.length ? await tx.select().from(personRoles).where(inArray(personRoles.roleId, watched)) : [];
    const everyone = await tx.select({ id: people.id, platformRole: people.platformRole }).from(people).where(eq(people.companyId, companyId));
    const give = new Map<string, string>(); // person -> Admin or Member
    for (const p of everyone) {
      const mine = held.filter((h) => h.personId === p.id);
      const wasAdmin = mine.some((h) => h.roleId === ownerRole?.id || (removed.find((r) => r.id === h.roleId)?.level ?? 1) >= 3);
      if (p.platformRole === 'owner' || p.platformRole === 'admin' || wasAdmin) give.set(p.id, adminId);
      else if (mine.length) give.set(p.id, memberId);
    }
    if (removedIds.length) {
      await tx.update(roles).set({ archived: true, updatedAt: new Date() }).where(inArray(roles.id, removedIds));
      await tx.delete(personRoles).where(inArray(personRoles.roleId, removedIds));
    }
    const changed = new Set<string>(held.map((h) => h.personId));
    for (const [personId, roleId] of give) {
      await tx.insert(personRoles).values({ personId, roleId }).onConflictDoNothing();
      changed.add(personId);
    }
    await tx.update(companies).set({ rolesModel: 2 }).where(eq(companies.id, companyId));
    // ensureBuiltIns again: the owners hold the Owner role, and the old Super Admin holders who are not owners no longer do.
    await this.ensureBuiltIns(tx, companyId, cat);
    await this.syncLevels(tx, companyId, [...changed]);
    const admins = [...give.values()].filter((r) => r === adminId).length;
    const members = [...give.values()].filter((r) => r === memberId).length;
    this.log.log(`Roles of company ${companyId} converted to Admin + Member: ${removed.length} template role(s) archived; ${admins} → Admin, ${members} → Member`);
    this.conversions.set(companyId, { archived: removed.map((r) => r.name), admin: admins, member: members });
    return [...changed];
  }

  /** What a conversion did, per company (printed by `company -- sync`). */
  readonly conversions = new Map<string, { archived: string[]; admin: number; member: number; extra?: number }>();

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

  /** The roles screen: Admin and Member first, then the roles made in the role builder. Hidden roles are never listed. */
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
      .where(and(eq(roles.companyId, caller.companyId), eq(roles.kind, 'role'), includeArchived ? sql`true` : eq(roles.archived, false)))
      .orderBy(sql`${roles.system} desc`, sql`${roles.level} desc`, asc(roles.name));
    const grants = rows.length
      ? await db.select().from(roleGrants).where(inArray(roleGrants.roleId, rows.map((r) => r.id)))
      : [];
    return rows.map((r) => ({
      ...r,
      grants: grants.filter((g) => g.roleId === r.id).map(({ app, permission, scope }) => ({ app, permission, scope })),
    }));
  }

  /** A listed role (hidden Owner and personal roles are not edited, copied or archived here). */
  private async getRole(companyId: string, id: string) {
    const [role] = await this.dbs.db.select().from(roles).where(and(eq(roles.id, id), eq(roles.companyId, companyId), eq(roles.kind, 'role'))).limit(1);
    if (!role) throw notFound('Role');
    return role;
  }

  private async freeCode(companyId: string, name: string): Promise<string> {
    const base = slug(name);
    for (let n = 1; ; n++) {
      // Never one of the old template codes: those mark roles to convert (PLAN.md §19.28).
      const code = n === 1 && !isTemplateCode(base) && !base.startsWith('ff_') ? base : `${base}_${n}`;
      const [taken] = await this.dbs.db.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, companyId), eq(roles.code, code))).limit(1);
      if (!taken) return code;
    }
  }

  private async assertNameFree(companyId: string, name: string, exceptId?: string) {
    const [taken] = await this.dbs.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, companyId), eq(roles.archived, false), sql`lower(${roles.name}) = lower(${name})`, exceptId ? sql`${roles.id} <> ${exceptId}` : sql`true`))
      .limit(1);
    if (taken) throw new ConflictException(`There is already a role called "${name}"`);
  }

  async create(caller: Caller, input: RoleInput) {
    const powers = await this.powersOf(caller);
    if (powers && input.level >= 3) throw new ForbiddenException('Only the owner can create or edit Admin-level roles');
    await this.assertNameFree(caller.companyId, input.name);
    const grants = await this.validGrants(caller.companyId, input.grants as Grant[]);
    if (powers) this.assertCanBuild(powers, await this.catalogue(caller.companyId), input.level, grants);
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
    if (role.archived) throw badRequest('This role is archived');
    if (role.system) {
      // Admin and Member: what they can do and their duties change; their name and level stay (PLAN.md §19.28).
      if (input.name !== undefined && input.name.trim().toLowerCase() !== role.name.toLowerCase()) throw badRequest(`${role.name} is built in: it keeps its name`, { name: 'Built-in roles keep their name' });
      if (input.level !== undefined && input.level !== role.level) throw badRequest(`${role.name} is built in: its level stays ${LEVEL_NAMES[role.level]}`, { level: 'Built-in roles keep their level' });
      input = { ...input, name: undefined, level: undefined };
    }
    if (input.name) await this.assertNameFree(caller.companyId, input.name, id);
    const grants = input.grants ? await this.validGrants(caller.companyId, input.grants as Grant[]) : null;
    const powers = await this.powersOf(caller);
    if (powers) {
      // Both the role as it is and as it will be must be within the caller's own powers.
      await this.assertCanTouch(caller, powers, role, 'edit');
      const cat = await this.catalogue(caller.companyId);
      this.assertCanBuild(powers, cat, input.level ?? role.level, grants ?? (await this.grantsOf([role.id])).get(role.id) ?? []);
    }
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
    // The copy is an ordinary role (R1 applies: a copy of Admin is Admin-level, so only the owner makes one). Only what
    // the apps offer today is copied (a permission an app no longer has is left out).
    const cat = await this.catalogue(caller.companyId);
    const offered = (g: { app: string; permission: string }) => !!cat.find((c) => c.app === g.app)?.permissions.some((p) => p.key === g.permission);
    return this.create(caller, {
      name,
      description: role.system ? null : role.description,
      colour: role.colour,
      level: role.level,
      grants: grants.filter(offered).map(({ app, permission, scope }) => ({ app: app as AppKey, permission, scope })),
      duties: (role.duties ?? []).map(({ id: _id, ...d }) => ({ ...d, steps: d.steps ?? [] })), // the copy's duties are its own
    });
  }

  /** Archives a role: nobody holds it any more (they lose apps it alone gave them); history keeps its name. */
  async archive(caller: Caller, id: string) {
    const role = await this.getRole(caller.companyId, id);
    if (role.system) throw new ForbiddenException(`${role.name} is built in: it cannot be deleted`);
    const powers = await this.powersOf(caller);
    if (powers) await this.assertCanTouch(caller, powers, role, 'archive');
    const holders = await this.holders(id);
    await this.dbs.db.transaction(async (tx) => {
      await tx.update(roles).set({ archived: true, updatedAt: new Date() }).where(eq(roles.id, id));
      await tx.delete(personRoles).where(eq(personRoles.roleId, id));
    });
    for (const personId of holders) await this.applyApps(caller.companyId, personId);
    const sync = await this.push(caller.companyId);
    return { ok: true, sync };
  }

  // ─── who may give what (docs/security/platform.md R1) ───────────────────

  /** Null for the owner (everything); otherwise the permissions (with their scopes) and the level the caller holds. */
  private async powersOf(caller: Caller): Promise<Powers | null> {
    if (caller.role === 'owner') return null;
    const mine = await heldAccess(this.dbs, caller.personId, caller.role);
    const held = new Map<string, Set<string>>();
    for (const g of mine.grants) {
      const k = `${g.app}:${g.permission}`;
      held.set(k, (held.get(k) ?? new Set()).add(g.scope));
    }
    return { level: mine.level, held };
  }

  private async grantsOf(roleIds: string[]): Promise<Map<string, Grant[]>> {
    const out = new Map<string, Grant[]>();
    if (!roleIds.length) return out;
    for (const g of await this.dbs.db.select().from(roleGrants).where(inArray(roleGrants.roleId, roleIds))) {
      out.set(g.roleId, [...(out.get(g.roleId) ?? []), { app: g.app as GrantApp, permission: g.permission, scope: g.scope }]);
    }
    return out;
  }

  /** The grants the caller cannot give: not held, held at a narrower scope, or Owner-only. Readable, for the 403. */
  private lacking(powers: Powers, cat: Catalogue[], grants: Grant[]): string[] {
    const out: string[] = [];
    for (const g of grants) {
      const p = cat.find((c) => c.app === g.app)?.permissions.find((x) => x.key === g.permission);
      const label = `${APP_NAMES[g.app] ?? g.app} · ${p?.label ?? g.permission}`;
      if (p?.superAdminOnly) {
        out.push(`${label} (Owner only)`);
        continue;
      }
      const mine = powers.held.get(`${g.app}:${g.permission}`);
      if (!mine) {
        out.push(label);
        continue;
      }
      if (p?.scopes && g.scope) {
        const best = Math.max(...[...mine].map((s) => p.scopes!.indexOf(s)));
        if (p.scopes.indexOf(g.scope) > best) out.push(`${label} at ${cap(g.scope)} (you have ${best >= 0 ? cap(p.scopes[best]) : 'none'})`);
      }
    }
    return out;
  }

  /** A role the caller makes or saves: below Admin level, at most their own level, and only permissions they have. */
  private assertCanBuild(powers: Powers, cat: Catalogue[], level: number, grants: Grant[]) {
    if (level >= 3) throw new ForbiddenException('Only the owner can create or edit Admin-level roles');
    if (level > powers.level) {
      throw new ForbiddenException(`You can give at most your own level (${LEVEL_NAMES[powers.level]}), not ${LEVEL_NAMES[level] ?? level}`);
    }
    const missing = this.lacking(powers, cat, grants);
    if (missing.length) throw new ForbiddenException(`You can only give permissions you have yourself. Not allowed: ${listed(missing)}`);
  }

  /** A role the caller edits or archives must already be within their powers (no taking a bigger role apart). */
  private async assertCanTouch(caller: Caller, powers: Powers, role: RoleRow, verb: 'edit' | 'archive') {
    if (role.level >= 3) throw new ForbiddenException(`Only the owner can ${verb} Admin-level roles`);
    const missing = this.lacking(powers, await this.catalogue(caller.companyId), (await this.grantsOf([role.id])).get(role.id) ?? []);
    if (role.level > powers.level || missing.length) {
      const why = role.level > powers.level ? `is ${levelRole(role.level)} (yours: ${LEVEL_NAMES[powers.level]})` : `has permissions you do not have yourself (${listed(missing)})`;
      throw new ForbiddenException(`Only the owner can ${verb} "${role.name}": it ${why}`);
    }
  }

  /** Giving roles to a person (themselves included): each one within the caller's own permissions and level. */
  private async assertCanGive(caller: Caller, given: RoleRow[]) {
    if (!given.length) return;
    const powers = await this.powersOf(caller);
    if (!powers) return;
    const cat = await this.catalogue(caller.companyId);
    const grants = await this.grantsOf(given.map((r) => r.id));
    for (const role of given) {
      if (role.level > powers.level) {
        throw new ForbiddenException(`You cannot give "${role.name}": it is ${levelRole(role.level)} and your own level is ${LEVEL_NAMES[powers.level]}`);
      }
      const missing = this.lacking(powers, cat, grants.get(role.id) ?? []);
      if (missing.length) throw new ForbiddenException(`You cannot give "${role.name}": it has permissions you do not have yourself (${listed(missing)})`);
    }
  }

  /**
   * Choosing a role inside an app when giving the app (PUT /people/:id/apps/:app) is giving its permissions: the same
   * rule, through the role builder's copy of that app role. An app role the role builder does not know: the owner only.
   */
  async assertCanGiveAppRole(caller: Caller, app: AppKey, appRole: string) {
    if (caller.role === 'owner') return;
    const code = app === 'tasks' ? appRole : `${app}:${appRole}`;
    const [role] = await this.dbs.db
      .select()
      .from(roles)
      .where(and(eq(roles.companyId, caller.companyId), eq(roles.code, code), eq(roles.kind, 'role'), eq(roles.archived, false)))
      .limit(1);
    if (!role) throw new ForbiddenException(`Only the owner can choose "${appRole}" inside ${APP_NAMES[app] ?? app}: it is not a role in the role builder`);
    await this.assertCanGive(caller, [role]);
  }

  private async holders(roleId: string): Promise<string[]> {
    return (await this.dbs.db.select({ id: personRoles.personId }).from(personRoles).where(eq(personRoles.roleId, roleId))).map((r) => r.id);
  }

  // ─── people's roles ─────────────────────────────────────────────────────

  /**
   * Each person's roles. `all`: the hidden Owner and personal roles too (what the apps get); otherwise only the roles
   * shown and given in the role builder.
   */
  async rolesOf(companyId: string, personIds: string[], { all = false } = {}): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!personIds.length) return out;
    const rows = await this.dbs.db
      .select({ personId: personRoles.personId, roleId: personRoles.roleId })
      .from(personRoles)
      .innerJoin(roles, eq(roles.id, personRoles.roleId))
      .where(and(inArray(personRoles.personId, personIds), eq(roles.companyId, companyId), eq(roles.archived, false), all ? sql`true` : eq(roles.kind, 'role')));
    for (const r of rows) out.set(r.personId, [...(out.get(r.personId) ?? []), r.roleId]);
    return out;
  }

  /** The built-in Admin and Member role ids (created first if this company has none yet). */
  async builtInIds(companyId: string): Promise<{ adminId: string; memberId: string }> {
    const rows = await this.dbs.db
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(and(eq(roles.companyId, companyId), inArray(roles.code, [ADMIN.code, MEMBER.code])));
    const adminId = rows.find((r) => r.code === ADMIN.code)?.id;
    const memberId = rows.find((r) => r.code === MEMBER.code)?.id;
    if (adminId && memberId) return { adminId, memberId };
    const cat = await this.catalogue(companyId);
    return this.dbs.db.transaction((tx) => this.ensureBuiltIns(tx, companyId, cat));
  }

  /** Gives a person exactly these roles; their apps follow (opened or closed), and the apps get the new roles. */
  async setPersonRoles(caller: Caller, personId: string, roleIds: string[]) {
    const db = this.dbs.db;
    const [person] = await db.select().from(people).where(and(eq(people.id, personId), eq(people.companyId, caller.companyId))).limit(1);
    if (!person) throw notFound('Person');
    // Same rule as People & access (PLAN.md §19.19): a member with Admin permissions acts on members only.
    if (caller.role === 'member' && person.platformRole !== 'member') throw new ForbiddenException('Only an owner or admin can change an admin’s roles');
    if (person.platformRole === 'owner' && caller.role !== 'owner') throw new ForbiddenException('Only an owner can change an owner’s roles');
    const wanted = [...new Set(roleIds)];
    const found = wanted.length
      ? await db.select().from(roles).where(and(inArray(roles.id, wanted), eq(roles.companyId, caller.companyId), eq(roles.kind, 'role'), eq(roles.archived, false)))
      : [];
    if (found.length !== wanted.length) throw badRequest('Unknown or archived role');
    const current = (await this.rolesOf(caller.companyId, [personId])).get(personId) ?? [];
    const { adminId } = await this.builtInIds(caller.companyId);
    if (personId === caller.personId && caller.role !== 'owner' && current.includes(adminId) && !wanted.includes(adminId)) {
      throw badRequest('You cannot take away your own Admin role');
    }
    // Only what the caller has themselves, at no higher level (R1): nobody but the owner raises anyone's access, their own included.
    await this.assertCanGive(caller, found.filter((r) => !current.includes(r.id)));
    await this.assertSeatForRoles(caller.companyId, personId, wanted);
    await db.transaction(async (tx) => {
      // Only the listed roles are replaced: the hidden Owner and personal roles stay.
      const listedRoles = tx.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, caller.companyId), eq(roles.kind, 'role')));
      await tx.delete(personRoles).where(and(eq(personRoles.personId, personId), inArray(personRoles.roleId, listedRoles)));
      if (wanted.length) await tx.insert(personRoles).values(wanted.map((roleId) => ({ personId, roleId })));
      await this.syncLevels(tx, caller.companyId, [personId]);
    });
    const apps = await this.applyApps(caller.companyId, personId);
    const sync = await this.push(caller.companyId);
    // A newly opened app needs the person's department and manager too.
    await this.moduleRef.get(DirectoryService, { strict: false }).push(caller.companyId);
    return { roleIds: wanted, apps, sync };
  }

  /**
   * "Make Admin" / "Make Member" (and the access level on People): Admin replaces Member, Member replaces Admin; other
   * roles stay. Same checks as giving roles.
   */
  async setLevel(caller: Caller, personId: string, level: 'admin' | 'member') {
    const { adminId, memberId } = await this.builtInIds(caller.companyId);
    const current = (await this.rolesOf(caller.companyId, [personId])).get(personId) ?? [];
    const next = level === 'admin' ? [...current.filter((id) => id !== memberId), adminId] : [...current.filter((id) => id !== adminId)];
    if (level === 'member' && !next.includes(memberId)) next.push(memberId);
    return this.setPersonRoles(caller, personId, [...new Set(next)]);
  }

  /** Roles that would open a first app for someone without one take a seat (PLAN.md §21): 402 when none is free. */
  private async assertSeatForRoles(companyId: string, personId: string, roleIds: string[]) {
    if (!roleIds.length) return;
    const enabled = await this.enabledApps(companyId);
    const apps = await this.dbs.db.selectDistinct({ app: roleGrants.app }).from(roleGrants).where(inArray(roleGrants.roleId, roleIds));
    if (!apps.some((a) => enabled.includes(a.app as AppKey) && internalUrl(a.app as AppKey))) return;
    await assertSeatFor(this.dbs, companyId, personId);
  }

  /** The R1 rule for roles chosen outside the role builder (invite links): only what the caller holds. */
  async assertCanGiveRoles(caller: Caller, roleIds: string[]) {
    const wanted = [...new Set(roleIds)];
    const found = wanted.length
      ? await this.dbs.db.select().from(roles).where(and(inArray(roles.id, wanted), eq(roles.companyId, caller.companyId), eq(roles.kind, 'role'), eq(roles.archived, false)))
      : [];
    if (found.length !== wanted.length) throw badRequest('Unknown or archived role', { roleIds: 'Unknown or archived role' });
    await this.assertCanGive(caller, found);
    return found;
  }

  /**
   * Gives roles already checked when the invite was made (a person joining by an invite link): their apps open, the
   * apps get the roles and the person's department. No role on the invite: Member. Never closes anything.
   */
  async giveRolesFromInvite(companyId: string, personId: string, roleIds: string[]) {
    let live = roleIds.length
      ? await this.dbs.db.select({ id: roles.id }).from(roles).where(and(inArray(roles.id, roleIds), eq(roles.companyId, companyId), eq(roles.kind, 'role'), eq(roles.archived, false)))
      : [];
    if (!live.length) live = [{ id: (await this.builtInIds(companyId)).memberId }];
    await this.dbs.db.transaction(async (tx) => {
      await tx.insert(personRoles).values(live.map((r) => ({ personId, roleId: r.id }))).onConflictDoNothing();
      await this.syncLevels(tx, companyId, [personId]);
    });
    await this.applyApps(companyId, personId, { close: false });
    await this.push(companyId);
  }

  /** Admin and Member back to their starting permissions and no duties; the owners hold Admin (`company -- reset`). */
  async resetBuiltIns(companyId: string) {
    const cat = await this.catalogue(companyId);
    await this.dbs.db.transaction(async (tx) => {
      const { adminId, memberId } = await this.ensureBuiltIns(tx, companyId, cat);
      await this.setGrants(tx, adminId, this.adminGrants(cat));
      await this.setGrants(tx, memberId, this.memberGrants(cat));
      await tx.update(roles).set({ duties: [], name: ADMIN.name, description: ADMIN.description, updatedAt: new Date() }).where(eq(roles.id, adminId));
      await tx.update(roles).set({ duties: [], name: MEMBER.name, description: MEMBER.description, updatedAt: new Date() }).where(eq(roles.id, memberId));
      const owners = await tx.select({ id: people.id }).from(people).where(and(eq(people.companyId, companyId), eq(people.platformRole, 'owner')));
      if (owners.length) await tx.insert(personRoles).values(owners.map((o) => ({ personId: o.id, roleId: adminId }))).onConflictDoNothing();
    });
  }

  // ─── a person's own extra access and responsibilities (PLAN.md §19.28) ──

  private async personalRole(companyId: string, personId: string) {
    return (await this.dbs.db.select().from(roles).where(and(eq(roles.companyId, companyId), eq(roles.kind, 'personal'), eq(roles.personId, personId))).limit(1))[0];
  }

  /**
   * What a person can do and where it comes from: their roles (listed), what those give together, their own extra
   * permissions and duties (the hidden personal role), and whether they are an owner (everything).
   */
  async personAccess(caller: Caller, personId: string) {
    const [person] = await this.dbs.db.select().from(people).where(and(eq(people.id, personId), eq(people.companyId, caller.companyId))).limit(1);
    if (!person) throw notFound('Person');
    await this.ensureUpgraded(caller.companyId);
    const cat = await this.catalogue(caller.companyId);
    const roleIds = (await this.rolesOf(caller.companyId, [personId])).get(personId) ?? [];
    const byRole = await this.grantsOf(roleIds);
    const fromRoles = this.union(cat, roleIds.map((id) => byRole.get(id) ?? []));
    const mine = await this.personalRole(caller.companyId, personId);
    const extra = mine ? ((await this.grantsOf([mine.id])).get(mine.id) ?? []) : [];
    return {
      personId,
      owner: person.platformRole === 'owner',
      roleIds,
      fromRoles,
      extra: { grants: extra, duties: mine?.duties ?? [] },
      /** Extra permissions that the roles do not already give (what the extra access really adds). */
      adds: this.beyond(cat, extra, fromRoles),
    };
  }

  /**
   * Sets a person's extra access (permissions + scope on top of their roles) and their own duties. Kept in a hidden
   * personal role, created on first use and deleted when emptied, so the apps check it like any role. R1: only what the
   * caller holds; nobody but the owner gives themselves anything; owners' access is the owners' business.
   */
  async setPersonalAccess(caller: Caller, personId: string, input: z.infer<typeof personalAccessSchema>) {
    const db = this.dbs.db;
    const [person] = await db.select().from(people).where(and(eq(people.id, personId), eq(people.companyId, caller.companyId))).limit(1);
    if (!person) throw notFound('Person');
    if (caller.role === 'member' && person.platformRole !== 'member') throw new ForbiddenException('Only an owner or admin can change an admin’s access');
    if (person.platformRole === 'owner' && caller.role !== 'owner') throw new ForbiddenException('Only an owner can change an owner’s access');
    if (personId === caller.personId && caller.role !== 'owner') throw new ForbiddenException('You cannot give yourself extra access');
    const grants = await this.validGrants(caller.companyId, input.grants as Grant[]);
    const powers = await this.powersOf(caller);
    const existing = await this.personalRole(caller.companyId, personId);
    if (powers) {
      const cat = await this.catalogue(caller.companyId);
      // Both what they have now and what they will have must be within the caller's own powers.
      const before = existing ? ((await this.grantsOf([existing.id])).get(existing.id) ?? []) : [];
      const missing = this.lacking(powers, cat, [...grants, ...before]);
      if (missing.length) throw new ForbiddenException(`You can only give permissions you have yourself. Not allowed: ${listed(missing)}`);
    }
    const duties = withIds(input.duties ?? []);
    if (!grants.length && !duties.length) {
      if (existing) {
        await db.delete(roles).where(eq(roles.id, existing.id)); // person_roles and grants go with it
        await this.applyApps(caller.companyId, personId);
      }
      const sync = await this.push(caller.companyId);
      return { ...(await this.personAccess(caller, personId)), sync };
    }
    if (grants.length) await this.assertSeatForGrants(caller.companyId, personId, grants);
    await db.transaction(async (tx) => {
      let roleId = existing?.id;
      if (!roleId) {
        const [r] = await tx
          .insert(roles)
          .values({
            companyId: caller.companyId,
            code: personalCode(personId),
            name: `Personal · ${person.fullName.slice(0, 60)} · ${personId.slice(0, 8)}`,
            description: `${person.fullName}'s own extra access and responsibilities`,
            level: 1,
            kind: 'personal',
            personId,
            duties,
          })
          .returning({ id: roles.id });
        roleId = r.id;
        await tx.insert(personRoles).values({ personId, roleId }).onConflictDoNothing();
      } else {
        await tx.update(roles).set({ duties, updatedAt: new Date() }).where(eq(roles.id, roleId));
      }
      await this.setGrants(tx, roleId, grants);
    });
    await this.applyApps(caller.companyId, personId);
    const sync = await this.push(caller.companyId);
    await this.moduleRef.get(DirectoryService, { strict: false }).push(caller.companyId);
    return { ...(await this.personAccess(caller, personId)), sync };
  }

  private async assertSeatForGrants(companyId: string, personId: string, grants: Grant[]) {
    const enabled = await this.enabledApps(companyId);
    if (!grants.some((g) => enabled.includes(g.app as AppKey) && internalUrl(g.app as AppKey))) return;
    await assertSeatFor(this.dbs, companyId, personId);
  }

  /** After an app was added to the company (plan upgrade): everyone whose roles reach it gets it. Nobody loses one here. */
  async openAppsFromRoles(companyId: string) {
    const holders = await this.dbs.db
      .selectDistinct({ id: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.companyId, companyId), eq(people.status, 'active')));
    for (const h of holders) {
      try {
        await this.applyApps(companyId, h.id, { close: false });
      } catch (err) {
        this.log.warn(`Opening apps for ${h.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * A person can open an app when one of their roles (the hidden Owner and personal roles included) has a permission in
   * it (and the company's plan includes it). Opens the apps they gained (the app finds or creates their user) and closes
   * the ones they lost.
   */
  async applyApps(companyId: string, personId: string, { close = true } = {}): Promise<AppKey[]> {
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
   * reported in the result and logged; `npm run company -- sync` sends everything again. The hidden Owner and personal
   * roles go too (codes `ff_owner`, `ff_person_<id>`), so the apps check them like any role.
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
      kind: r.kind,
      grants: grants.filter((g) => g.roleId === r.id).map(({ app, permission, scope }) => ({ app, permission, scope })),
      duties: r.duties ?? [],
    }));
    const result: Record<string, string> = {};
    for (const app of (c?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a))) {
      if (!internalUrl(app)) continue;
      const holders = await db.select({ personId: personApps.personId }).from(personApps).innerJoin(people, eq(people.id, personApps.personId)).where(and(eq(people.companyId, companyId), eq(personApps.app, app)));
      const byPerson = await this.rolesOf(companyId, holders.map((h) => h.personId), { all: true });
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
   * First time only (a company with no roles yet): Admin, Member and the hidden Owner role (PLAN.md §19.28). People the
   * apps already know (an imported company, e.g. CarTrends) are mapped from their app roles: an Admin-level role (or
   * the admin access level) → Admin; anything else → Member, plus a personal role with whatever their old roles gave
   * beyond Member, so nobody loses access. Owners get Admin and the Owner role. Returns false when the company already
   * had roles.
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
      // The apps' roles are already in today's catalogues: nothing to upgrade later.
      await tx.update(companies).set({ accessUpgrades: Object.fromEntries(cat.map((a) => [a.app, a.version ?? 1])), rolesModel: 2 }).where(eq(companies.id, companyId));
      const { adminId, memberId } = await this.ensureBuiltIns(tx, companyId, cat);
      const memberBase = this.memberGrants(cat);

      // What each person had in each app: the grants and level of their app roles there.
      const had = new Map<string, { level: number; grants: Grant[][] }>();
      for (const { app, data } of appExports) {
        const known = cat.find((c) => c.app === app)!;
        const byCode = new Map(data.roles.filter((r) => !r.archived).map((r) => [r.code, r]));
        for (const p of data.people) {
          for (const code of p.roles) {
            const r = byCode.get(code);
            if (!r) continue;
            const grants = r.grants
              .filter((g) => known.permissions.some((x) => x.key === g.permission))
              .map((g) => {
                const perm = known.permissions.find((x) => x.key === g.permission)!;
                const scope = g.scope ?? '';
                return { app, permission: g.permission, scope: perm.scopes ? (perm.scopes.includes(scope) ? scope : (perm.legacyScope ?? perm.scopes[0])) : '' };
              });
            const cur = had.get(p.personId) ?? { level: 1, grants: [] };
            cur.level = Math.max(cur.level, r.level ?? 1);
            cur.grants.push(grants);
            had.set(p.personId, cur);
          }
        }
      }
      const everyone = await tx.select({ id: people.id, fullName: people.fullName, platformRole: people.platformRole }).from(people).where(eq(people.companyId, companyId));
      const extras: Array<{ personId: string; fullName: string; grants: Grant[] }> = [];
      let admins = 0;
      let members = 0;
      for (const p of everyone) {
        const h = had.get(p.id);
        const admin = p.platformRole === 'owner' || p.platformRole === 'admin' || (h?.level ?? 1) >= 3;
        if (admin) {
          await tx.insert(personRoles).values({ personId: p.id, roleId: adminId }).onConflictDoNothing();
          admins++;
          continue;
        }
        if (!h) continue; // not in any app yet: no role (they get one when someone gives them access)
        await tx.insert(personRoles).values({ personId: p.id, roleId: memberId }).onConflictDoNothing();
        members++;
        const more = this.beyond(cat, this.union(cat, h.grants), memberBase);
        if (more.length) extras.push({ personId: p.id, fullName: p.fullName, grants: more });
      }
      for (const e of extras) {
        const [r] = await tx
          .insert(roles)
          .values({
            companyId,
            code: personalCode(e.personId),
            name: `Personal · ${e.fullName.slice(0, 60)} · ${e.personId.slice(0, 8)}`,
            description: `${e.fullName}'s own extra access (from their old app roles)`,
            level: 1,
            kind: 'personal',
            personId: e.personId,
          })
          .returning({ id: roles.id });
        await this.setGrants(tx, r.id, e.grants);
        await tx.insert(personRoles).values({ personId: e.personId, roleId: r.id }).onConflictDoNothing();
      }
      await this.ensureBuiltIns(tx, companyId, cat); // owners hold the Owner role
      await this.syncLevels(tx, companyId, everyone.map((p) => p.id));
      this.conversions.set(companyId, { archived: [], admin: admins, member: members, extra: extras.length });
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
