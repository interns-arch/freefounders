import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSIONS,
  type Permission,
  roleSchema,
  type RoleInput,
  userCreateSchema,
  type UserCreateInput,
  userUpdateSchema,
  type UserUpdateInput,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { badRequest, conflict, CurrentActor, likePattern, listParams, notFound, RequirePermissions, ZodPipe } from '../../common/http';
import { CredentialVault } from '../../core/credential-vault.service';
import { SequenceService } from '../../core/sequence.service';
import { DbService } from '../../db/db.service';
import { employees, roles, users } from '../../db/schema';
import { diffChanges, HistoryService } from '../../core/history.service';
import { AuthService } from '../auth/auth.service';

const publicUser = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  roleId: users.roleId,
  roleName: roles.name,
  employeeId: users.employeeId,
  employeeName: employees.fullName,
  employeeCode: employees.employeeCode,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  hasSavedPassword: sql<boolean>`${users.passwordSaved} is not null`,
  passwordSavedAt: users.passwordSavedAt,
  createdAt: users.createdAt,
};

@Injectable()
export class AdminService {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly auth: AuthService,
    private readonly sequences: SequenceService,
    private readonly vault: CredentialVault,
  ) {}

  /** Shows the saved password of a login. Every look is written to the activity log. */
  async revealPassword(actor: Actor, id: string) {
    const [u] = await this.dbs.db
      .select({ name: users.name, email: users.email, username: users.username, employeeCode: employees.employeeCode, sealed: users.passwordSaved, savedAt: users.passwordSavedAt, savedByName: users.passwordSavedByName })
      .from(users)
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(eq(users.id, id));
    if (!u) throw notFound('User');
    const password = await this.vault.open(u.sealed);
    if (password) {
      await this.history.record(actor, { entityType: 'USER', entityId: id, entityLabel: u.email ?? u.name, action: 'PASSWORD_VIEWED', summary: `Saved password of ${u.name} viewed` });
    }
    return { loginId: u.username ?? u.employeeCode ?? u.email, email: u.email, password, savedAt: u.savedAt, savedByName: u.savedByName };
  }

  async listUsers(q: Record<string, string>) {
    const p = listParams(q, { sort: 'name', dir: 'asc' });
    const like = p.search ? likePattern(p.search) : null;
    const where = like ? or(ilike(users.name, like), ilike(users.email, like), ilike(users.username, like), ilike(roles.name, like)) : undefined;
    const db = this.dbs.db;
    const [items, [{ total }]] = await Promise.all([
      db
        .select(publicUser)
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .leftJoin(employees, eq(employees.id, users.employeeId))
        .where(where)
        .orderBy(asc(users.name))
        .limit(p.pageSize)
        .offset(p.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async createUser(actor: Actor, input: UserCreateInput) {
    return this.dbs.tx(async (db) => {
      await this.auth.assertLoginFree(input, { employeeId: input.employeeId });
      const [role] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, input.roleId));
      if (!role) throw badRequest('That role no longer exists', { roleId: 'Not found' });
      const { employeeCode, ...values } = input;
      // Everyone with a login is on the employee list, except the CEO / leadership.
      const employeeId = input.employeeId ?? (role.permissions.includes('insights:leadership') ? null : await this.addStaffEmployee(actor, input.name, input.email ?? null, employeeCode ?? null));
      const [row] = await db
        .insert(users)
        .values({ ...values, employeeId, ...(await this.auth.passwordFields(input.password, actor.name)) })
        .returning({ id: users.id, name: users.name, email: users.email });
      await this.history.record(actor, { entityType: 'USER', entityId: row.id, entityLabel: row.email ?? row.name, action: 'CREATED', summary: `User ${row.email ?? row.name} created` });
      return row;
    });
  }

  private async addStaffEmployee(actor: Actor, name: string, email: string | null, code: string | null) {
    const db = this.dbs.db;
    const employeeCode = code ?? (await this.sequences.next('STAFF', 3));
    const [codeTaken] = await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.employeeCode}) = lower(${employeeCode})`);
    if (codeTaken) throw badRequest('Another employee already has this employee ID', { employeeCode: 'Already in use' });
    const [emailTaken] = email ? await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.email}) = lower(${email})`) : [];
    const [firstName, ...rest] = name.trim().split(/\s+/);
    const [emp] = await db
      .insert(employees)
      .values({ employeeCode, firstName, lastName: rest.join(' ') || null, email: emailTaken ? null : email, companyId: await this.dbs.defaultCompanyId() })
      .returning({ id: employees.id, fullName: employees.fullName });
    await this.history.record(actor, { entityType: 'EMPLOYEE', entityId: emp.id, entityLabel: emp.fullName, employeeId: emp.id, action: 'CREATED', summary: `${emp.fullName} (${employeeCode}) added with their portal login` });
    return emp.id;
  }

  async updateUser(actor: Actor, id: string, input: UserUpdateInput) {
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(users).where(eq(users.id, id)).for('update');
      if (!before) throw notFound('User');
      await this.auth.assertLoginFree(input, { userId: id, employeeId: input.employeeId ?? before.employeeId });
      if (id === actor.userId && (input.isActive === false || (input.roleId && input.roleId !== before.roleId))) {
        throw badRequest('You cannot deactivate yourself or change your own role.');
      }
      const { password, ...rest } = input;
      const after = { ...before, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
      if (!after.email && !after.username && !after.employeeId) throw badRequest('Keep a login ID, an email or a linked employee so they can still sign in', { username: 'Required' });
      const changes = diffChanges(before, rest, { name: 'Name', username: 'Login ID', email: 'Email', roleId: 'Role', employeeId: 'Linked employee', isActive: 'Active' });
      const patch: Partial<typeof users.$inferInsert> = { ...rest, updatedAt: new Date() };
      if (password) {
        Object.assign(patch, await this.auth.passwordFields(password, actor.name));
        patch.failedLogins = 0;
        patch.lockedUntil = null;
        changes.push({ field: 'password', label: 'Password', from: '••••', to: 'reset' });
      }
      await db.update(users).set(patch).where(eq(users.id, id));
      if (password || input.isActive === false || (input.roleId && input.roleId !== before.roleId)) {
        await this.auth.revokeUserSessions(id);
      }
      if (changes.length) {
        await this.history.record(actor, { entityType: 'USER', entityId: id, entityLabel: before.email ?? before.name, action: 'UPDATED', summary: `User ${before.email ?? before.name} updated`, changes });
      }
      return { ok: true };
    });
  }

  async listRoles() {
    return this.dbs.db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        permissions: roles.permissions,
        isSystem: roles.isSystem,
        userCount: sql<number>`(select count(*)::int from users u where u.role_id = roles.id)`,
      })
      .from(roles)
      .orderBy(asc(roles.createdAt));
  }

  private clean(permissions: string[]): Permission[] {
    return [...new Set(permissions)].filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
  }

  async createRole(actor: Actor, input: RoleInput) {
    return this.dbs.tx(async (db) => {
      const [row] = await db.insert(roles).values({ ...input, permissions: this.clean(input.permissions) }).returning();
      await this.history.record(actor, { entityType: 'ROLE', entityId: row.id, entityLabel: row.name, action: 'CREATED', summary: `Role "${row.name}" created` });
      return row;
    });
  }

  async updateRole(actor: Actor, id: string, input: RoleInput) {
    return this.dbs.tx(async (db) => {
      const [before] = await db.select().from(roles).where(eq(roles.id, id)).for('update');
      if (!before) throw notFound('Role');
      const permissions = this.clean(input.permissions);
      if (before.isSystem && before.name === 'Admin' && (!ADMIN_PERMISSIONS.every((p) => permissions.includes(p)) || input.name !== 'Admin')) {
        throw badRequest('The Admin role keeps full access and cannot be renamed.');
      }
      const changes = diffChanges(before, { ...input, permissions }, { name: 'Name', description: 'Description', permissions: 'Permissions' });
      if (!changes.length) return before;
      const [row] = await db.update(roles).set({ ...input, permissions, updatedAt: new Date() }).where(eq(roles.id, id)).returning();
      await this.history.record(actor, { entityType: 'ROLE', entityId: id, entityLabel: row.name, action: 'UPDATED', summary: `Role "${row.name}" updated`, changes });
      return row;
    });
  }

  async deleteRole(actor: Actor, id: string) {
    return this.dbs.tx(async (db) => {
      const [role] = await db.select().from(roles).where(eq(roles.id, id));
      if (!role) throw notFound('Role');
      if (role.isSystem) throw badRequest('Built-in roles cannot be deleted.');
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.roleId, id));
      if (n) throw conflict(`${n} user(s) have this role. Move them to another role first.`);
      await db.delete(roles).where(and(eq(roles.id, id), ne(roles.isSystem, true)));
      await this.history.record(actor, { entityType: 'ROLE', entityId: id, entityLabel: role.name, action: 'DELETED', summary: `Role "${role.name}" deleted` });
      return { ok: true };
    });
  }
}

@Controller('users')
@RequirePermissions('user:manage')
export class UsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query() q: Record<string, string>) {
    return this.admin.listUsers(q);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(userCreateSchema)) body: UserCreateInput) {
    return this.admin.createUser(actor, body);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(userUpdateSchema)) body: UserUpdateInput) {
    return this.admin.updateUser(actor, id, body);
  }

  @Get(':id/password')
  password(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.revealPassword(actor, id);
  }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @RequirePermissions('user:manage')
  list() {
    return this.admin.listRoles();
  }

  @Post()
  @RequirePermissions('user:manage')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(roleSchema)) body: RoleInput) {
    return this.admin.createRole(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('user:manage')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(roleSchema)) body: RoleInput) {
    return this.admin.updateRole(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('user:manage')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteRole(actor, id);
  }
}

/** Lightweight list of users for pickers (e.g. ticket assignee). */
@Controller('directory')
export class DirectoryController {
  constructor(private readonly dbs: DbService) {}

  @Get('staff')
  @RequirePermissions('ticket:manage', 'user:manage')
  staff() {
    return this.dbs.db
      .select({ id: users.id, name: users.name, roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.isActive, true), sql`cardinality(${roles.permissions}) > 2`))
      .orderBy(asc(users.name));
  }
}

@Module({
  providers: [AdminService],
  controllers: [UsersController, RolesController, DirectoryController],
})
export class AdminModule {}
