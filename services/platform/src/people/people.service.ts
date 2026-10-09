import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService, hashPassword } from '../auth/auth.service';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, logins, people, personApps, personRoles, PLATFORM_ROLES, refreshSessions, roles } from '../db/schema';
import { ProvisionClient } from '../provision/provision.client';
import { DirectoryService } from './directory.service';
import { FlowsService } from './flows.service';

const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable().optional());

export const loginIdSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters')
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only');
export const passwordSchema = z.string().min(6, 'Use at least 6 characters').max(200);

const personFields = {
  fullName: z.string().trim().min(1, 'Name is required').max(120),
  email: optional(z.string().trim().toLowerCase().email('Enter a valid email').max(200)),
  employeeCode: optional(
    z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9._/-]+$/, 'Letters, numbers, dot, dash, slash and underscore only'),
  ),
  mobile: optional(
    z
      .string()
      .trim()
      .regex(/^\+?[0-9 -]{7,20}$/, 'Enter a valid mobile number'),
  ),
  platformRole: z.enum(PLATFORM_ROLES).optional(),
  // People directory (PLAN.md §17.1)
  departmentId: optional(z.string().uuid()),
  designation: optional(z.string().trim().max(80)),
  reportsTo: optional(z.string().uuid()),
  joinDate: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-08')),
};

export const personCreateSchema = z.object({
  ...personFields,
  login: z.object({ username: optional(loginIdSchema), password: passwordSchema.optional() }).optional(),
});
export const personUpdateSchema = z.object({
  ...personFields,
  fullName: personFields.fullName.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
export const setLoginSchema = z.object({
  username: optional(loginIdSchema),
  password: passwordSchema.optional(),
  /** Default true: they pick their own password at their next sign-in. */
  mustChangePassword: z.boolean().optional(),
});
export const deletePersonSchema = z.object({ confirm: z.string().max(200, 'Too long') });
export const grantSchema = z.object({ appRole: z.string().trim().max(60).optional() });

export type PersonCreate = z.infer<typeof personCreateSchema>;
export type PersonUpdate = z.infer<typeof personUpdateSchema>;

/** Readable one-time password, e.g. "k7q2-m9xd-4fha". */
function generatePassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => abc[b % abc.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((c) => c.join('')).join('-');
}

@Injectable()
export class PeopleService {
  private readonly log = new Logger('People');

  constructor(
    private readonly dbs: DbService,
    private readonly auth: AuthService,
    private readonly provisioner: ProvisionClient,
    private readonly directory: DirectoryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async list(caller: Caller, search = '') {
    const db = this.dbs.db;
    const q = search.trim().toLowerCase().slice(0, 100);
    const rows = await db
      .select({
        person: people,
        username: logins.username,
        hasLogin: sql<boolean>`${logins.personId} is not null`,
        lastLoginAt: logins.lastLoginAt,
        lockedUntil: logins.lockedUntil,
      })
      .from(people)
      .leftJoin(logins, eq(logins.personId, people.id))
      .where(
        and(
          eq(people.companyId, caller.companyId),
          q
            ? sql`(lower(${people.fullName}) like ${'%' + q + '%'} or lower(coalesce(${people.email},'')) like ${'%' + q + '%'}
                 or lower(coalesce(${people.employeeCode},'')) like ${'%' + q + '%'} or lower(coalesce(${logins.username},'')) like ${'%' + q + '%'})`
            : undefined,
        ),
      )
      .orderBy(asc(people.fullName))
      .limit(500);
    const grants = rows.length
      ? await db
          .select({ personId: personApps.personId, app: personApps.app })
          .from(personApps)
          .innerJoin(people, eq(people.id, personApps.personId))
          .where(eq(people.companyId, caller.companyId))
      : [];
    const held = rows.length
      ? await db
          .select({ personId: personRoles.personId, roleId: personRoles.roleId })
          .from(personRoles)
          .innerJoin(roles, eq(roles.id, personRoles.roleId))
          .where(and(eq(roles.companyId, caller.companyId), eq(roles.archived, false)))
      : [];
    return rows.map((r) => ({
      ...this.view(r.person),
      login: r.hasLogin ? { username: r.username, lastLoginAt: r.lastLoginAt, locked: !!r.lockedUntil && r.lockedUntil > new Date() } : null,
      apps: grants.filter((g) => g.personId === r.person.id).map((g) => g.app),
      roleIds: held.filter((h) => h.personId === r.person.id).map((h) => h.roleId),
    }));
  }

  private view(p: typeof people.$inferSelect) {
    return {
      id: p.id,
      fullName: p.fullName,
      email: p.email,
      employeeCode: p.employeeCode,
      mobile: p.mobile,
      platformRole: p.platformRole,
      status: p.status,
      departmentId: p.departmentId,
      designation: p.designation,
      reportsTo: p.reportsTo,
      joinDate: p.joinDate,
      lastWorkingDate: p.lastWorkingDate,
      createdAt: p.createdAt,
    };
  }

  private async get(caller: Caller, id: string) {
    const [p] = await this.dbs.db
      .select()
      .from(people)
      .where(and(eq(people.id, id), eq(people.companyId, caller.companyId)))
      .limit(1);
    if (!p) throw notFound('Person');
    return p;
  }

  /**
   * Sign-in tries username before employee ID, so a username must never equal someone else's employee ID
   * (or it would capture their sign-in), and an employee ID must never equal another person's username.
   */
  private async assertIdentifiersFree(personId: string | null, username?: string | null, employeeCode?: string | null) {
    const db = this.dbs.db;
    const self = personId ?? '00000000-0000-0000-0000-000000000000';
    if (username) {
      const [clash] = await db
        .select({ id: people.id })
        .from(people)
        .where(and(sql`lower(${people.employeeCode}) = lower(${username})`, ne(people.id, self)))
        .limit(1);
      if (clash) throw badRequest('This is another person’s employee ID — choose a different username', { 'login.username': 'Taken' });
    }
    if (employeeCode) {
      const [clash] = await db
        .select({ id: logins.personId })
        .from(logins)
        .where(and(sql`lower(${logins.username}) = lower(${employeeCode})`, ne(logins.personId, self)))
        .limit(1);
      if (clash) throw badRequest('Another person signs in with this as their username', { employeeCode: 'Taken' });
    }
  }

  /** Only an owner may create, promote to, or change an owner. */
  private assertRoleChange(caller: Caller, targetRole: string | undefined, currentRole?: string) {
    if ((targetRole === 'owner' || currentRole === 'owner') && caller.role !== 'owner') {
      throw new ForbiddenException('Only an owner can change owners');
    }
  }

  async create(caller: Caller, input: PersonCreate) {
    this.assertRoleChange(caller, input.platformRole);
    await this.assertIdentifiersFree(null, input.login?.username, input.employeeCode);
    await this.directory.assertDepartment(caller.companyId, input.departmentId);
    await this.directory.assertReportsTo(caller.companyId, null, input.reportsTo);
    const created = await this.dbs.tx(async (tx) => {
      const [p] = await tx
        .insert(people)
        .values({
          companyId: caller.companyId,
          fullName: input.fullName,
          email: input.email ?? null,
          employeeCode: input.employeeCode ?? null,
          mobile: input.mobile ?? null,
          platformRole: input.platformRole ?? 'member',
          departmentId: input.departmentId ?? null,
          designation: input.designation ?? null,
          reportsTo: input.reportsTo ?? null,
          joinDate: input.joinDate ?? null,
        })
        .returning();
      let generatedPassword: string | undefined;
      if (input.login) {
        if (!input.login.username && !p.email && !p.employeeCode) {
          throw badRequest('A login needs a username, email or employee ID to sign in with', { 'login.username': 'Required' });
        }
        const password = input.login.password ?? (generatedPassword = generatePassword());
        await tx.insert(logins).values({ personId: p.id, username: input.login.username ?? null, passwordHash: await hashPassword(password), mustChangePassword: true });
      }
      return { person: this.view(p), generatedPassword };
    });
    return created;
  }

  async update(caller: Caller, id: string, input: PersonUpdate) {
    const current = await this.get(caller, id);
    this.assertRoleChange(caller, input.platformRole, current.platformRole);
    if (id === caller.personId && ((input.status && input.status !== 'active') || (input.platformRole && input.platformRole !== current.platformRole))) {
      throw badRequest('You cannot deactivate yourself or change your own access level');
    }
    if (current.platformRole === 'owner' && ((input.platformRole && input.platformRole !== 'owner') || input.status === 'inactive')) {
      await this.assertAnotherOwner(caller.companyId, id);
    }
    if (input.employeeCode !== undefined) await this.assertIdentifiersFree(id, null, input.employeeCode);
    if (input.departmentId !== undefined) await this.directory.assertDepartment(caller.companyId, input.departmentId);
    if (input.reportsTo !== undefined) await this.directory.assertReportsTo(caller.companyId, id, input.reportsTo);

    const [p] = await this.dbs.db
      .update(people)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
        ...(input.platformRole ? { platformRole: input.platformRole } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.designation !== undefined ? { designation: input.designation } : {}),
        ...(input.reportsTo !== undefined ? { reportsTo: input.reportsTo } : {}),
        ...(input.joinDate !== undefined ? { joinDate: input.joinDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(people.id, id))
      .returning();
    if (input.status === 'inactive') await this.auth.revokeAll(id);
    // Department, manager, active/inactive reach the apps (deactivated people are switched off there too).
    const sync = await this.directory.push(caller.companyId);
    return { ...this.view(p), sync };
  }

  private async assertAnotherOwner(companyId: string, exceptId: string) {
    const [other] = await this.dbs.db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.companyId, companyId), eq(people.platformRole, 'owner'), eq(people.status, 'active'), ne(people.id, exceptId)))
      .limit(1);
    if (!other) throw badRequest('A company needs at least one active owner');
  }

  /**
   * Creates or resets a person's login, with the admin's own password or a generated one (returned once, never stored
   * readable). They must change it at their next sign-in unless the admin turns that off.
   */
  async setLogin(caller: Caller, id: string, input: z.infer<typeof setLoginSchema>) {
    const p = await this.get(caller, id);
    if (p.platformRole === 'owner' && caller.role !== 'owner' && caller.personId !== id) {
      throw new ForbiddenException('Only an owner can reset an owner’s password');
    }
    await this.assertIdentifiersFree(id, input.username, null);
    const [existing] = await this.dbs.db.select().from(logins).where(eq(logins.personId, id)).limit(1);
    const username = input.username !== undefined ? input.username : (existing?.username ?? null);
    if (!username && !p.email && !p.employeeCode) {
      throw badRequest('A login needs a username, email or employee ID to sign in with', { username: 'Required' });
    }
    let generatedPassword: string | undefined;
    const password = input.password ?? (generatedPassword = generatePassword());
    const values = { username, passwordHash: await hashPassword(password), mustChangePassword: input.mustChangePassword ?? true, failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() };
    if (existing) await this.dbs.db.update(logins).set(values).where(eq(logins.personId, id));
    else await this.dbs.db.insert(logins).values({ personId: id, ...values });
    await this.auth.revokeAll(id);
    return { ok: true, username, generatedPassword };
  }

  async removeLogin(caller: Caller, id: string) {
    const p = await this.get(caller, id);
    if (id === caller.personId) throw badRequest('You cannot remove your own login');
    if (p.platformRole === 'owner') await this.assertAnotherOwner(caller.companyId, id);
    await this.dbs.db.delete(logins).where(eq(logins.personId, id));
    await this.auth.revokeAll(id);
    return { ok: true };
  }

  /**
   * Deletes a person and every record about them in every app (PLAN.md §19.12). The owner cannot be deleted, nobody
   * deletes themselves, and only the owner deletes an admin. The caller types the person's full name to confirm.
   * Order: switch them off and end their sessions; each app the company has deletes its records (any failure stops
   * here with a 502: they stay switched off and the admin can retry); then the Platform rows; then the directory push.
   */
  async deletePerson(caller: Caller, id: string, confirm: string) {
    if (caller.role !== 'owner' && caller.role !== 'admin') throw new ForbiddenException('Only admins can delete people');
    const p = await this.get(caller, id);
    if (id === caller.personId) throw badRequest('You cannot delete yourself');
    if (p.platformRole === 'owner') throw new ForbiddenException('The owner cannot be deleted');
    if (p.platformRole === 'admin' && caller.role !== 'owner') throw new ForbiddenException('Only the owner can delete an admin');
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!confirm || norm(confirm) !== norm(p.fullName)) {
      throw badRequest('Type their full name exactly to confirm', { confirm: 'Does not match their name' });
    }

    // (a) Off everywhere first, so nothing new is written about them while the apps delete.
    if (p.status !== 'inactive') await this.dbs.db.update(people).set({ status: 'inactive', updatedAt: new Date() }).where(eq(people.id, id));
    await this.auth.revokeAll(id);

    // (b) Every app the company has; the first one that cannot delete stops everything (throws 502).
    const [company] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
    const appResults: Partial<Record<AppKey, Record<string, number>>> = {};
    for (const app of (company?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a))) {
      try {
        const res = await this.provisioner.deletePerson(app, caller.companyId, id);
        appResults[app] = res.deleted ? (res.counts ?? {}) : {};
      } catch (err) {
        this.log.warn(`Delete person ${id} stopped at ${app}: ${(err as Error).message}`);
        throw err;
      }
    }

    // (c) The Platform's own rows.
    await this.dbs.tx(async (tx) => {
      await tx.update(people).set({ reportsTo: null, updatedAt: new Date() }).where(eq(people.reportsTo, id));
      await tx.delete(logins).where(eq(logins.personId, id));
      await tx.delete(refreshSessions).where(eq(refreshSessions.personId, id));
      await tx.delete(personRoles).where(eq(personRoles.personId, id));
      await tx.delete(personApps).where(eq(personApps.personId, id));
      await tx.delete(people).where(and(eq(people.id, id), eq(people.companyId, caller.companyId)));
    });

    // (d) The apps get the directory without them (and with nobody reporting to them).
    const sync = await this.directory.push(caller.companyId);
    return { deleted: true, apps: appResults, sync };
  }

  /** Gives a person an app: the app finds or creates their user there, and we remember that user's id. */
  async grantApp(caller: Caller, id: string, app: string, appRole?: string) {
    if (!(APPS as readonly string[]).includes(app)) throw notFound('App');
    const p = await this.get(caller, id);
    const [company] = await this.dbs.db.select({ enabledApps: companies.enabledApps }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
    if (!company?.enabledApps.includes(app)) throw badRequest(`Your plan does not include ${app}`);
    const [login] = await this.dbs.db.select({ username: logins.username }).from(logins).where(eq(logins.personId, id)).limit(1);
    const localUserId = await this.provisioner.provision(app as AppKey, caller.companyId, {
      personId: p.id,
      fullName: p.fullName,
      email: p.email,
      employeeCode: p.employeeCode,
      mobile: p.mobile,
      username: login?.username ?? null,
      appRole,
      platformRole: p.platformRole,
    });
    await this.dbs.db
      .insert(personApps)
      .values({ personId: id, app, localUserId })
      .onConflictDoUpdate({ target: [personApps.personId, personApps.app], set: { localUserId, grantedAt: new Date() } });
    await this.directory.push(caller.companyId); // the new user gets their department and manager
    if (app === 'assets') await this.moduleRef.get(FlowsService, { strict: false }).onboardIfJoining(caller.companyId, id);
    return { app, localUserId };
  }

  /** Takes an app away. Signs the person out so their next token no longer lists it. */
  async revokeApp(caller: Caller, id: string, app: string) {
    await this.get(caller, id);
    await this.dbs.db.delete(personApps).where(and(eq(personApps.personId, id), eq(personApps.app, app)));
    await this.auth.revokeAll(id);
    return { ok: true };
  }
}
