import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService, hashPassword } from '../auth/auth.service';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { accountUsernameTaken, lockUsername, usernameConflict } from '../accounts/username';
import { accounts, type AppKey, APPS, companies, departments, logins, people, personApps, personRoles, PLATFORM_ROLES, refreshSessions, roles } from '../db/schema';
import { EXPORT_MAX, type ExportFormat, exportFile, when } from '../common/export';
import type { SheetCell } from '../common/sheet';
import { assertNewSeat, assertSeatFor, isReadOnly, paymentRequired, READ_ONLY_MESSAGE, seatLimit, seatsFullMessage, seatsUsed, subscriptionOf } from '../billing/seats';
import { IMPORT_COLUMNS, IMPORT_EXAMPLE, IMPORT_MAX_ROWS, type ImportRow, parseDate, parseRole, readImportFile } from './people-import';
import { ProvisionClient } from '../provision/provision.client';
import { RolesService } from '../roles/roles.service';
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
  // No forced change at the next sign-in any more (founder, docs/security/platform.md R7): an old client's
  // `mustChangePassword` is simply ignored. They can change it themselves from the account menu.
});
/** Delete choices (PLAN.md §19.12): `to` is a Platform person id; the apps find that person's user themselves. */
const handOverOr = <M extends string>(other: M) =>
  z.discriminatedUnion('mode', [
    z.object({ mode: z.literal(other) }).strict(),
    z.object({ mode: z.literal('hand_over'), to: z.string().uuid('Choose who takes them over') }).strict(),
  ]);
export const deleteOptionsSchema = z
  .object({
    /** Their open tasks (Tasks). */
    tasks: handOverOr('delete').optional(),
    /** Leads assigned to or created by them (Tasks), with their tasks when deleted. */
    leads: handOverOr('delete').optional(),
    /** Finished tasks, attendance, leave, payslips, comments…: kept under "Deleted user", or erased (both apps). */
    history: z.object({ mode: z.enum(['delete', 'keep']) }).strict().optional(),
    /** Assets they hold (Assets): back to stock or to someone. */
    assets: handOverOr('stock').optional(),
  })
  .strict();
export type DeleteOptions = z.infer<typeof deleteOptionsSchema>;
export const deletePersonSchema = z.object({ confirm: z.string().max(200, 'Too long'), options: deleteOptionsSchema.optional() });

/** Which app gets which delete choice. */
const DELETE_KEYS: Record<AppKey, Array<keyof DeleteOptions>> = { tasks: ['tasks', 'leads', 'history'], assets: ['history', 'assets'] };
const APP_LABEL: Record<AppKey, string> = { tasks: 'Tasks', assets: 'Assets' };
export const grantSchema = z.object({ appRole: z.string().trim().max(60).optional() });

/** Bulk import (PLAN.md §19.40): the file as uploaded (base64), or the rows checked in the preview. */
export const importFileSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1, 'Choose a file').max(1_000_000, 'The file is too big (at most about 700 KB)'),
});
const importCell = z.string().max(300).optional().default('');
export const importRowsSchema = z.object({
  rows: z
    .array(
      z.object({
        line: z.number().int().positive().optional(),
        fullName: importCell,
        email: importCell,
        mobile: importCell,
        employeeCode: importCell,
        department: importCell,
        designation: importCell,
        reportsTo: importCell,
        joinDate: importCell,
        role: importCell,
      }),
    )
    .min(1, 'Nothing to import')
    .max(IMPORT_MAX_ROWS),
});
const importFieldsSchema = z.object({
  fullName: personFields.fullName,
  email: personFields.email,
  employeeCode: personFields.employeeCode,
  mobile: personFields.mobile,
  designation: personFields.designation,
});
const FIELD_LABEL: Record<string, string> = { fullName: 'Name', email: 'Email', employeeCode: 'Employee ID', mobile: 'Mobile', designation: 'Designation' };
const emptyRow = (): Omit<ImportRow, 'line'> => ({ fullName: '', email: '', mobile: '', employeeCode: '', department: '', designation: '', reportsTo: '', joinDate: '', role: '' });

/** The message of a refused step (HttpException body or Error), for an import result line. */
function problemText(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'string') return body;
    const m = (body as { message?: unknown }).message;
    return Array.isArray(m) ? m.join(' ') : String(m ?? err.message);
  }
  return err instanceof Error ? err.message : 'Could not be added';
}

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

  async list(caller: Caller, search = '', limit = 500) {
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
      .limit(limit);
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
          .where(and(eq(roles.companyId, caller.companyId), eq(roles.archived, false), eq(roles.kind, 'role')))
      : [];
    // Who has extra access or own duties of their own (a hidden personal role, PLAN.md §19.28).
    const personal = rows.length
      ? await db.select({ personId: roles.personId }).from(roles).where(and(eq(roles.companyId, caller.companyId), eq(roles.kind, 'personal')))
      : [];
    return rows.map((r) => ({
      ...this.view(r.person),
      login: r.hasLogin ? { username: r.username, lastLoginAt: r.lastLoginAt, locked: !!r.lockedUntil && r.lockedUntil > new Date() } : null,
      apps: grants.filter((g) => g.personId === r.person.id).map((g) => g.app),
      roleIds: held.filter((h) => h.personId === r.person.id).map((h) => h.roleId),
      extraAccess: personal.some((x) => x.personId === r.person.id),
    }));
  }

  /**
   * The People list as spreadsheet rows (PLAN.md §19.31): the same search and company as the screen, every match
   * (up to EXPORT_MAX), with department, manager and role names resolved.
   */
  async exportRows(caller: Caller, search = '') {
    const list = await this.list(caller, search, EXPORT_MAX);
    const db = this.dbs.db;
    const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.companyId, caller.companyId));
    const roleRows = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.companyId, caller.companyId));
    const managers = await db.select({ id: people.id, fullName: people.fullName }).from(people).where(eq(people.companyId, caller.companyId));
    const dept = new Map(depts.map((d) => [d.id, d.name]));
    const role = new Map(roleRows.map((r) => [r.id, r.name]));
    const manager = new Map(managers.map((m) => [m.id, m.fullName]));
    const header = ['Name', 'Employee ID', 'Username', 'Email', 'Mobile', 'Level', 'Department', 'Designation', 'Reports to', 'Join date', 'Last working date', 'Roles', 'Apps', 'Extra access', 'Status', 'Last sign-in'];
    const rows: SheetCell[][] = list.map((p) => [
      p.fullName,
      p.employeeCode,
      p.login?.username ?? null,
      p.email,
      p.mobile,
      p.platformRole,
      p.departmentId ? (dept.get(p.departmentId) ?? null) : null,
      p.designation,
      p.reportsTo ? (manager.get(p.reportsTo) ?? null) : null,
      when(p.joinDate),
      when(p.lastWorkingDate),
      p.roleIds.map((id) => role.get(id)).filter(Boolean).join(', '),
      p.apps.join(', '),
      p.extraAccess,
      p.status === 'active' ? 'Active' : p.status === 'inactive' ? 'Inactive' : p.status,
      when(p.login?.lastLoginAt ?? null),
    ]);
    return { header, rows };
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
      // One namespace with the usernames people chose for their accounts (PLAN.md §21.5).
      if (await accountUsernameTaken(db, username)) throw usernameConflict(personId ? 'username' : 'login.username');
    }
    if (employeeCode) {
      const [clash] = await db
        .select({ id: logins.personId })
        .from(logins)
        .where(and(sql`lower(${logins.username}) = lower(${employeeCode})`, ne(logins.personId, self)))
        .limit(1);
      if (clash) throw badRequest('Another person signs in with this as their username', { employeeCode: 'Taken' });
      const [own] = personId ? await db.select({ accountId: people.accountId }).from(people).where(eq(people.id, personId)).limit(1) : [];
      const [acc] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(sql`lower(${accounts.username}) = lower(${employeeCode})`, own?.accountId ? ne(accounts.id, own.accountId) : undefined))
        .limit(1);
      if (acc) throw badRequest('Another person signs in with this as their username', { employeeCode: 'Taken' });
    }
  }

  /** Only an owner may create, promote to, or change an owner; a member (with an Admin permission) only members. */
  private assertRoleChange(caller: Caller, targetRole: string | undefined, currentRole?: string) {
    if ((targetRole === 'owner' || currentRole === 'owner') && caller.role !== 'owner') {
      throw new ForbiddenException('Only an owner can change owners');
    }
    if (caller.role === 'member' && ((targetRole && targetRole !== 'member') || (currentRole && currentRole !== 'member'))) {
      throw new ForbiddenException('Only an owner or admin can change admins');
    }
  }

  /** People admin by a member with an Admin permission reaches members only (PLAN.md §19.19). */
  private assertMemberTarget(caller: Caller, target: { platformRole: string }) {
    if (caller.role === 'member' && target.platformRole !== 'member') throw new ForbiddenException('Only an owner or admin can change admins');
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
          // admin follows the Admin role (given below, PLAN.md §19.28); owner is a mark of its own.
          platformRole: input.platformRole === 'owner' ? 'owner' : 'member',
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
        if (input.login.username) {
          // Same name chosen for an account at this moment: the lock orders the two, the later one sees it taken.
          await lockUsername(tx, input.login.username);
          if (await accountUsernameTaken(tx, input.login.username)) throw usernameConflict('login.username');
        }
        await tx.insert(logins).values({ personId: p.id, username: input.login.username ?? null, passwordHash: await hashPassword(password), mustChangePassword: false });
      }
      return { person: this.view(p), generatedPassword };
    });
    if (input.platformRole === 'admin') {
      try {
        await this.rolesSvc.setLevel(caller, created.person.id, 'admin');
      } catch (err) {
        // Nothing half-made: without the Admin role (e.g. no free seat) the person is not added.
        await this.dbs.db.delete(logins).where(eq(logins.personId, created.person.id));
        await this.dbs.db.delete(people).where(eq(people.id, created.person.id));
        throw err;
      }
      return { ...created, person: { ...created.person, platformRole: 'admin' } };
    }
    return created;
  }

  private get rolesSvc() {
    return this.moduleRef.get(RolesService, { strict: false });
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
    if (input.status === 'active' && current.status !== 'active') {
      // Switching someone with apps back on takes a seat again (PLAN.md §21).
      const [hasApp] = await this.dbs.db.select({ app: personApps.app }).from(personApps).where(eq(personApps.personId, id)).limit(1);
      if (hasApp) await assertNewSeat(this.dbs, caller.companyId);
    }

    // Admin / Member is the built-in role (PLAN.md §19.28): changing the level gives or takes the Admin role.
    const level = input.platformRole && input.platformRole !== current.platformRole ? input.platformRole : undefined;
    if (level && level !== 'owner' && current.platformRole !== 'owner') await this.rolesSvc.setLevel(caller, id, level);
    const [p] = await this.dbs.db
      .update(people)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
        ...(level && (level === 'owner' || current.platformRole === 'owner') ? { platformRole: level } : {}),
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
    if (level && (level === 'owner' || current.platformRole === 'owner')) {
      // An owner made or unmade: the Owner role follows; a former owner keeps (or gets) the role of their new level.
      if (level !== 'owner') await this.rolesSvc.setLevel({ ...caller, role: 'owner' }, id, level);
      else await this.rolesSvc.push(caller.companyId);
    }
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
   * readable). They are not forced to change it (R7); they can from the account menu.
   */
  async setLogin(caller: Caller, id: string, input: z.infer<typeof setLoginSchema>) {
    const p = await this.get(caller, id);
    if (p.platformRole === 'owner' && caller.role !== 'owner' && caller.personId !== id) {
      throw new ForbiddenException('Only an owner can reset an owner’s password');
    }
    if (caller.personId !== id) this.assertMemberTarget(caller, p);
    await this.assertIdentifiersFree(id, input.username, null);
    const [existing] = await this.dbs.db.select().from(logins).where(eq(logins.personId, id)).limit(1);
    const username = input.username !== undefined ? input.username : (existing?.username ?? null);
    if (!username && !p.email && !p.employeeCode) {
      throw badRequest('A login needs a username, email or employee ID to sign in with', { username: 'Required' });
    }
    let generatedPassword: string | undefined;
    const password = input.password ?? (generatedPassword = generatePassword());
    const values = { username, passwordHash: await hashPassword(password), mustChangePassword: false, failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() };
    await this.dbs.tx(async (tx) => {
      if (username && username.toLowerCase() !== existing?.username?.toLowerCase()) {
        await lockUsername(tx, username);
        if (await accountUsernameTaken(tx, username)) throw usernameConflict();
      }
      if (existing) await tx.update(logins).set(values).where(eq(logins.personId, id));
      else await tx.insert(logins).values({ personId: id, ...values });
    });
    await this.auth.revokeAll(id);
    return { ok: true, username, generatedPassword };
  }

  async removeLogin(caller: Caller, id: string) {
    const p = await this.get(caller, id);
    if (id === caller.personId) throw badRequest('You cannot remove your own login');
    this.assertMemberTarget(caller, p);
    if (p.platformRole === 'owner') await this.assertAnotherOwner(caller.companyId, id);
    await this.dbs.db.delete(logins).where(eq(logins.personId, id));
    await this.auth.revokeAll(id);
    return { ok: true };
  }

  /**
   * Deletes a person (PLAN.md §19.12). The owner cannot be deleted, nobody deletes themselves, and only the owner deletes
   * an admin. The caller types the person's full name to confirm. Without `options` every record about them goes; with
   * them, open tasks / leads / held assets can be handed over and their history kept under "Deleted user".
   * Order: check everything (incl. the hand-over people); switch them off and end their sessions; each app the company
   * has deletes / hands over (a 400 = the app refused the choices before changing anything: 400, and they are switched
   * back on if no app had done anything yet; any other failure: 502, they stay switched off and the admin can retry);
   * then the Platform rows; then the directory push.
   */
  async deletePerson(caller: Caller, id: string, confirm: string, options?: DeleteOptions) {
    if (caller.permissions && !caller.permissions.has('people.delete')) throw new ForbiddenException('You do not have permission to do this');
    const p = await this.get(caller, id);
    if (id === caller.personId) throw badRequest('You cannot delete yourself');
    if (p.platformRole === 'owner') throw new ForbiddenException('The owner cannot be deleted');
    if (p.platformRole === 'admin' && caller.role !== 'owner') throw new ForbiddenException('Only the owner can delete an admin');
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!confirm || norm(confirm) !== norm(p.fullName)) {
      throw badRequest('Type their full name exactly to confirm', { confirm: 'Does not match their name' });
    }
    const [company] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
    const apps = (company?.apps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
    if (options) await this.assertDeleteOptions(caller.companyId, id, apps, options);

    // (a) Off everywhere first, so nothing new is written about them while the apps delete.
    if (p.status !== 'inactive') await this.dbs.db.update(people).set({ status: 'inactive', updatedAt: new Date() }).where(eq(people.id, id));
    await this.auth.revokeAll(id);

    // (b) Every app the company has; the first one that cannot delete stops everything.
    const counts: Partial<Record<AppKey, Record<string, number>>> = {};
    const handedOver: Partial<Record<AppKey, Record<string, number>>> = {};
    const anonymised: Partial<Record<AppKey, boolean>> = {};
    const done: AppKey[] = [];
    for (const app of apps) {
      const mine = options ? Object.fromEntries(DELETE_KEYS[app].filter((k) => options[k]).map((k) => [k, options[k]])) : {};
      try {
        const res = await this.provisioner.deletePerson(app, caller.companyId, id, Object.keys(mine).length ? mine : undefined);
        counts[app] = res.deleted ? (res.counts ?? {}) : {};
        if (res.handedOver) handedOver[app] = res.handedOver;
        if (res.anonymised !== undefined) anonymised[app] = res.anonymised;
        done.push(app);
      } catch (err) {
        this.log.warn(`Delete person ${id} stopped at ${app}: ${(err as Error).message}`);
        if (err instanceof BadRequestException) {
          if (!done.length) {
            // Nothing was changed anywhere: they are back as they were (their sessions stay ended).
            if (p.status !== 'inactive') await this.dbs.db.update(people).set({ status: p.status, updatedAt: new Date() }).where(eq(people.id, id));
            throw err;
          }
          const already = done.map((a) => APP_LABEL[a]).join(' and ');
          throw badRequest(`${err.message} (${already} already removed their data, so they stay switched off: change the choice and try again.)`);
        }
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
    return { deleted: true, apps: counts, handedOver, anonymised, sync };
  }

  /** A hand-over person must be someone else, active, in this company, and have the app that takes the work over. */
  private async assertDeleteOptions(companyId: string, id: string, apps: AppKey[], options: DeleteOptions) {
    const needs: Array<[keyof DeleteOptions, AppKey]> = [
      ['tasks', 'tasks'],
      ['leads', 'tasks'],
      ['assets', 'assets'],
    ];
    for (const [key, app] of needs) {
      const choice = options[key] as { mode: string; to?: string } | undefined;
      if (!choice || choice.mode !== 'hand_over' || !choice.to) continue;
      const field = { [`options.${key}.to`]: 'Choose someone else' };
      if (!apps.includes(app)) throw badRequest(`Your plan does not include ${APP_LABEL[app]}`, field);
      if (choice.to === id) throw badRequest('Hand over to someone other than the person being deleted', field);
      const [to] = await this.dbs.db
        .select({ fullName: people.fullName, status: people.status, hasApp: sql<boolean>`${personApps.personId} is not null` })
        .from(people)
        .leftJoin(personApps, and(eq(personApps.personId, people.id), eq(personApps.app, app)))
        .where(and(eq(people.id, choice.to), eq(people.companyId, companyId)))
        .limit(1);
      if (!to) throw badRequest('The person to hand over to was not found', field);
      if (to.status !== 'active') throw badRequest(`${to.fullName} is not active`, field);
      if (!to.hasApp) throw badRequest(`${to.fullName} does not have ${APP_LABEL[app]}`, field);
    }
  }

  /** Gives a person an app: the app finds or creates their user there, and we remember that user's id. */
  async grantApp(caller: Caller, id: string, app: string, appRole?: string) {
    if (!(APPS as readonly string[]).includes(app)) throw notFound('App');
    const p = await this.get(caller, id);
    this.assertMemberTarget(caller, p);
    // An app role is a set of powers inside that app (e.g. Tasks' Super Admin): choosing one is giving permissions.
    if (appRole && !caller.permissions?.has('roles.manage')) throw new ForbiddenException('Choosing a role inside an app needs the Manage roles permission');
    // ...and, like giving roles, only one within the caller's own permissions and level (R1).
    if (appRole && (APPS as readonly string[]).includes(app)) await this.moduleRef.get(RolesService, { strict: false }).assertCanGiveAppRole(caller, app as AppKey, appRole);
    const [company] = await this.dbs.db.select({ enabledApps: companies.enabledApps }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
    if (!company?.enabledApps.includes(app)) throw badRequest(`Your plan does not include ${app}`);
    await assertSeatFor(this.dbs, caller.companyId, id);
    return this.giveApp(caller.companyId, p, app as AppKey, appRole);
  }

  /**
   * Opens an app for a person already checked (an admin's grant above, or an invite link): the app finds or creates
   * their user, we remember its id, the apps get their department and manager, and a new Assets user is onboarded.
   */
  async giveApp(companyId: string, p: typeof people.$inferSelect, app: AppKey, appRole?: string) {
    const id = p.id;
    const [login] = await this.dbs.db.select({ username: logins.username }).from(logins).where(eq(logins.personId, id)).limit(1);
    const localUserId = await this.provisioner.provision(app, companyId, {
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
    await this.directory.push(companyId); // the new user gets their department and manager
    if (app === 'assets') await this.moduleRef.get(FlowsService, { strict: false }).onboardIfJoining(companyId, id);
    return { app, localUserId };
  }

  // ─── bulk import (PLAN.md §19.40) ─────────────────────────────────────────────

  /** The template file: the columns and one example row. */
  importTemplate(format: ExportFormat) {
    return exportFile(format, 'people-import-template', [...IMPORT_COLUMNS], [IMPORT_EXAMPLE]);
  }

  /** Reads the uploaded file and checks every row; nothing is saved. */
  async importPreview(caller: Caller, input: z.infer<typeof importFileSchema>) {
    let rows: ImportRow[];
    try {
      rows = readImportFile(input.fileName, Buffer.from(input.content, 'base64'));
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'This file could not be read');
    }
    const plan = await this.planImport(caller, rows);
    return { ...plan, rows: plan.rows.map(({ departmentId: _d, reportsToId: _r, reportsToLine: _l, ...r }) => r) };
  }

  /**
   * Adds the rows that pass the checks, each the way the single "Add person" does it: the person, a login with a
   * generated password when they have an email or employee ID (returned once, never stored readable), and the Admin or
   * Member role (which opens their apps and takes a seat). Rows with problems are skipped and reported.
   */
  async importPeople(caller: Caller, input: z.infer<typeof importRowsSchema>) {
    const plan = await this.planImport(caller, input.rows.map((r, i) => ({ ...emptyRow(), ...r, line: r.line ?? i + 2 })));
    const created = new Map<number, string>();
    const results: Array<{ line: number; fullName: string; status: 'added' | 'skipped'; error?: string; personId?: string; signIn?: string | null; password?: string | null }> = [];
    for (const r of plan.rows) {
      if (r.errors.length) {
        results.push({ line: r.line, fullName: r.fullName, status: 'skipped', error: r.errors.join(' ') });
        continue;
      }
      try {
        const res = await this.create(caller, {
          fullName: r.fullName,
          email: r.email || null,
          employeeCode: r.employeeCode || null,
          mobile: r.mobile || null,
          platformRole: r.level,
          departmentId: r.departmentId,
          designation: r.designation || null,
          reportsTo: r.reportsToId,
          joinDate: r.joinDate || null,
          ...(r.login ? { login: {} } : {}),
        });
        if (r.level === 'member') {
          try {
            await this.rolesSvc.setLevel(caller, res.person.id, 'member');
          } catch (err) {
            // Nothing half-made (e.g. the last seat was taken meanwhile): the person is not added.
            await this.dbs.db.delete(logins).where(eq(logins.personId, res.person.id));
            await this.dbs.db.delete(people).where(eq(people.id, res.person.id));
            throw err;
          }
        }
        created.set(r.line, res.person.id);
        results.push({ line: r.line, fullName: r.fullName, status: 'added', personId: res.person.id, signIn: r.login ? r.email || r.employeeCode : null, password: res.generatedPassword ?? null });
      } catch (err) {
        results.push({ line: r.line, fullName: r.fullName, status: 'skipped', error: problemText(err) });
      }
    }
    // Managers who are themselves in the file: set once both are added.
    for (const r of plan.rows) {
      const id = created.get(r.line);
      const manager = r.reportsToLine ? created.get(r.reportsToLine) : undefined;
      if (id && manager) await this.dbs.db.update(people).set({ reportsTo: manager, updatedAt: new Date() }).where(eq(people.id, id));
    }
    const added = results.filter((r) => r.status === 'added').length;
    const sync = added ? await this.directory.push(caller.companyId) : {};
    this.log.log(`People import in ${caller.companyId} by ${caller.personId}: ${added} added, ${results.length - added} skipped`);
    return { added, skipped: results.length - added, results, sync };
  }

  /** Every check of an import, row by row: fields, duplicates, other people's sign-ins, managers, seats. */
  private async planImport(caller: Caller, rows: ImportRow[]) {
    const db = this.dbs.db;
    const cid = caller.companyId;
    const { sub, plan } = await subscriptionOf(this.dbs, cid);
    if (isReadOnly(sub.state)) throw paymentRequired(READ_ONLY_MESSAGE);
    const limit = seatLimit(sub, plan);
    const used = await seatsUsed(this.dbs, cid);
    const depts = await db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).where(eq(departments.companyId, cid));
    const existing = await db.select({ id: people.id, email: people.email, employeeCode: people.employeeCode }).from(people).where(eq(people.companyId, cid));
    const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const inCompanyEmail = new Map(existing.filter((e) => e.email).map((e) => [lower(e.email), e.id]));
    const inCompanyCode = new Map(existing.filter((e) => e.employeeCode).map((e) => [lower(e.employeeCode), e.id]));
    const emails = [...new Set(rows.map((r) => lower(r.email)).filter(Boolean))];
    const codes = [...new Set(rows.map((r) => lower(r.employeeCode)).filter(Boolean))];
    // Sign-ins that belong to someone else: an admin-made person elsewhere with this email (it signs them in), an
    // account with this email, a login or account whose username is this employee ID. Never taken over.
    const elsewhere = new Set(
      emails.length
        ? (await db.select({ e: sql<string>`lower(${people.email})` }).from(people).where(and(inArray(sql`lower(${people.email})`, emails), sql`${people.accountId} is null`, ne(people.companyId, cid)))).map((r) => r.e)
        : [],
    );
    const accountEmails = new Set(emails.length ? (await db.select({ e: sql<string>`lower(${accounts.email})` }).from(accounts).where(inArray(sql`lower(${accounts.email})`, emails))).map((r) => r.e) : []);
    const takenNames = new Set(
      codes.length
        ? [
            ...(await db.select({ u: sql<string>`lower(${logins.username})` }).from(logins).where(inArray(sql`lower(${logins.username})`, codes))).map((r) => r.u),
            ...(await db.select({ u: sql<string>`lower(${accounts.username})` }).from(accounts).where(inArray(sql`lower(${accounts.username})`, codes))).map((r) => r.u),
          ]
        : [],
    );

    const fileEmail = new Map<string, number>();
    const fileCode = new Map<string, number>();
    for (const r of rows) {
      if (r.email && !fileEmail.has(lower(r.email))) fileEmail.set(lower(r.email), r.line);
      if (r.employeeCode && !fileCode.has(lower(r.employeeCode))) fileCode.set(lower(r.employeeCode), r.line);
    }

    const planned = rows.map((r) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const fields = importFieldsSchema.safeParse({ fullName: r.fullName, email: r.email, employeeCode: r.employeeCode, mobile: r.mobile, designation: r.designation });
      if (!fields.success) {
        const seen = new Set<string>();
        for (const issue of fields.error.issues) {
          const key = String(issue.path[0] ?? '');
          if (seen.has(key)) continue;
          seen.add(key);
          errors.push(`${FIELD_LABEL[key] ?? key}: ${issue.message}.`);
        }
      }
      const email = lower(r.email);
      const code = lower(r.employeeCode);
      if (email && fileEmail.get(email) !== r.line) errors.push(`Email ${r.email} is also on line ${fileEmail.get(email)}.`);
      if (code && fileCode.get(code) !== r.line) errors.push(`Employee ID ${r.employeeCode} is also on line ${fileCode.get(code)}.`);
      if (email && inCompanyEmail.has(email)) errors.push(`${r.email} is already in People.`);
      else if (email && elsewhere.has(email)) errors.push(`${r.email} already signs in someone else in Kaampilot; use another email.`);
      else if (email && accountEmails.has(email)) errors.push(`${r.email} has a Kaampilot account; invite them with a link instead.`);
      if (code && inCompanyCode.has(code)) errors.push(`Employee ID ${r.employeeCode} is already in People.`);
      else if (code && takenNames.has(code)) errors.push(`Employee ID ${r.employeeCode} is someone else's username; use another.`);
      const level = parseRole(r.role);
      if (!level) errors.push(`Role "${r.role}": use Admin or Member.`);
      else if (level === 'admin' && caller.role === 'member') errors.push('Only an owner or admin can add admins.');
      let departmentId: string | null = null;
      if (r.department) {
        const d = depts.find((x) => lower(x.name) === lower(r.department) || lower(x.code) === lower(r.department));
        if (d) departmentId = d.id;
        else errors.push(`Department "${r.department}" does not exist; add it in Settings → Departments first.`);
      }
      let joinDate = '';
      if (r.joinDate) {
        joinDate = parseDate(r.joinDate) ?? '';
        if (!joinDate) errors.push(`Join date "${r.joinDate}": use a date like 2026-10-01.`);
      }
      let reportsToId: string | null = null;
      let reportsToLine: number | null = null;
      if (r.reportsTo) {
        const key = lower(r.reportsTo);
        const inFile = fileCode.get(key) ?? fileEmail.get(key);
        if (inCompanyCode.has(key) || inCompanyEmail.has(key)) reportsToId = (inCompanyCode.get(key) ?? inCompanyEmail.get(key))!;
        else if (inFile && inFile !== r.line) reportsToLine = inFile;
        else if (inFile === r.line) errors.push('A person cannot report to themselves.');
        else errors.push(`Reports to "${r.reportsTo}": nobody with this employee ID or email.`);
      }
      const login = !!(email || code);
      if (!login) warnings.push('No email or employee ID: added without a login (give one later with Reset password).');
      return { ...r, joinDate: joinDate || r.joinDate, level: level ?? 'member', departmentId, reportsToId, reportsToLine, login, errors, warnings };
    });

    // Managers inside the file: no loops.
    const byLine = new Map(planned.map((p) => [p.line, p]));
    for (const p of planned) {
      const seen = new Set<number>([p.line]);
      for (let next = p.reportsToLine; next; next = byLine.get(next)?.reportsToLine ?? null) {
        if (seen.has(next)) {
          p.errors.push('Reports-to makes a loop inside the file.');
          break;
        }
        seen.add(next);
      }
    }
    // Seats (PLAN.md §21): each new person takes one; rows past the free ones are not added.
    let free = limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
    for (const p of planned) {
      if (p.errors.length) continue;
      if (free <= 0) p.errors.push(seatsFullMessage(limit ?? 0, plan, sub.state));
      else free--;
    }
    // A manager row that will not be added leaves the rows under it without a manager: say so (they are still added).
    for (const p of planned) {
      const m = p.reportsToLine ? byLine.get(p.reportsToLine) : undefined;
      if (m && m.errors.length) p.warnings.push(`Reports to "${p.reportsTo}" is not being added (line ${m.line}), so no manager is set.`);
    }
    const ok = planned.filter((p) => !p.errors.length).length;
    return { rows: planned, ready: ok, problems: planned.length - ok, seats: { limit, used, free: limit === null ? null : Math.max(0, limit - used) } };
  }

  /** Takes an app away. Signs the person out so their next token no longer lists it. */
  async revokeApp(caller: Caller, id: string, app: string) {
    this.assertMemberTarget(caller, await this.get(caller, id));
    await this.dbs.db.delete(personApps).where(and(eq(personApps.personId, id), eq(personApps.app, app)));
    await this.auth.revokeAll(id);
    return { ok: true };
  }
}
