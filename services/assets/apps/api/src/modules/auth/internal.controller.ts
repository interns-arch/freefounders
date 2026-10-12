import { Body, ConflictException, Controller, Get, HttpCode, Post, Put, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Response } from 'express';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNotNull, ne, notInArray, sql } from 'drizzle-orm';
import { ADMIN_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS } from '@eam/shared';
import { z } from 'zod';
import { type Actor, SYSTEM_ACTOR } from '../../common/actor';
import { type AuthedRequest, badRequest, Public, ZodPipe } from '../../common/http';
import { HistoryService } from '../../core/history.service';
import { SequenceService } from '../../core/sequence.service';
import { DbService } from '../../db/db.service';
import { MODULES, ProfileService, profilePushSchema } from '../../core/profile.service';
import { employees, roles, sessions, syncState, userRoles, users } from '../../db/schema';
import { ensureRegistry, listCompanies, migrateCompanySchema, registerCompany, schemaFor, schemaForCode, tenancyEnabled } from '../../db/tenancy';
import { createSystemRoles, setUpCompany } from '../../seed/company-setup';
import { CatalogService } from '../catalog/catalog.service';
import { OrgService } from '../org/org.service';
import { PERMISSION_HINTS } from './permission-hints';
import { bearerToken, SERVICE_AUDIENCE, verifyPlatformToken } from './platform-token';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const provisionSchema = z.object({
  personId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.preprocess(blank, z.string().trim().toLowerCase().email().nullable().optional()),
  employeeCode: z.preprocess(blank, z.string().trim().max(40).nullable().optional()),
  mobile: z.preprocess(blank, z.string().trim().max(30).nullable().optional()),
  username: z.preprocess(blank, z.string().trim().max(50).nullable().optional()),
  appRole: z.preprocess(blank, z.string().trim().max(60).nullable().optional()),
  platformRole: z.preprocess(blank, z.string().trim().max(20).nullable().optional()),
});
type ProvisionInput = z.infer<typeof provisionSchema>;
const ACCESS_VERSION_KEY = 'ff_access_version';
const accessSchema = z.object({
  version: z.number().int().min(0),
  complete: z.boolean().optional(),
  roles: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string().max(60).nullable().optional(),
      name: z.string().trim().min(1).max(120),
      description: z.string().max(300).nullable().optional(),
      archived: z.boolean().optional(),
      grants: z.array(z.object({ app: z.string().optional(), permission: z.string().max(60), scope: z.string().max(20).nullable().optional() })),
    }).passthrough(),
  ),
  people: z.array(z.object({ personId: z.string().uuid(), roleIds: z.array(z.string().uuid()) })),
});
const companySchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
});

const PLATFORM_ACTOR: Actor = { userId: null, name: 'FreeFounders Platform', email: null, employeeId: null, roleName: 'System', permissions: new Set() };

/**
 * Internal API the FreeFounders Platform calls; not for browsers. Authenticated by a 60-second Platform
 * service token (audience assets-internal), checked here because the route is otherwise public.
 */
@Controller('internal')
export class InternalController {
  constructor(
    private readonly dbs: DbService,
    private readonly history: HistoryService,
    private readonly sequences: SequenceService,
    private readonly moduleRef: ModuleRef,
    private readonly profile: ProfileService,
  ) {}

  /** The modules Assets can switch on or off, with their defaults for a new company (PLAN.md §16.2). */
  @Public()
  @Get('modules')
  async modules(@Req() req: AuthedRequest) {
    await this.requireService(req);
    return { app: 'assets', modules: MODULES };
  }

  /** The company's names, colour, logo address and module switches from the Settings Center. */
  @Public()
  @Put('company')
  async company(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    return this.profile.apply(new ZodPipe(profilePushSchema).transform(raw));
  }

  /**
   * Multi-company mode: the Platform sets up a company in Assets. Creates its schema (or brings it up to date),
   * registers it, and on first creation adds what every company starts with. Idempotent.
   */
  @Public()
  @Post('companies')
  async createCompany(@Req() req: AuthedRequest, @Body() raw: unknown, @Res({ passthrough: true }) res: Response) {
    await this.requireService(req);
    if (!tenancyEnabled()) throw new ConflictException('Multi-company mode is off (TENANCY=schemas)');
    const input = new ZodPipe(companySchema).transform(raw);
    let schema: string;
    try {
      schema = schemaForCode(input.code);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const pool = this.dbs.pool;
    await ensureRegistry(pool);
    const existing = await schemaFor(pool, input.companyId);
    if (existing && existing !== schema) throw new ConflictException(`Company already set up as ${existing}`);
    if (!existing && (await listCompanies(pool)).some((c) => c.schema === schema)) throw new ConflictException('This company code is already used');

    await migrateCompanySchema(pool, schema);
    await registerCompany(pool, { companyId: input.companyId, schema, name: input.name });
    const created = await this.dbs.inCompany(schema, () =>
      this.dbs.tx(async (db) => {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(roles);
        if (n > 0) return false;
        await createSystemRoles(db);
        const services = { org: this.moduleRef.get(OrgService, { strict: false }), catalog: this.moduleRef.get(CatalogService, { strict: false }) };
        await setUpCompany(services, SYSTEM_ACTOR, { name: input.name, code: input.code.toUpperCase() });
        return true;
      }),
    );
    res.status(created ? 201 : 200);
    return { companyId: input.companyId, schema, created };
  }

  /**
   * The Platform gives a person access to Assets: find their login here (already linked, else same employee
   * ID, email or login ID) or create one, link it, and return its id. Never takes over a login that belongs
   * to another Platform person.
   */
  @Public()
  @Post('provision')
  @HttpCode(200)
  async provision(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(provisionSchema).transform(raw);
    return this.dbs.tx(() => this.findOrCreate(input));
  }

  /** Roles an admin can pick when giving someone Assets access. */
  @Public()
  @Get('roles')
  async roles(@Req() req: AuthedRequest) {
    await this.requireService(req);
    const rows = await this.dbs.db.select({ name: roles.name, description: roles.description }).from(roles).where(eq(roles.archived, false)).orderBy(asc(roles.name));
    return rows.map((r) => ({ value: r.name, label: r.name, description: r.description }));
  }

  /** The permissions Assets offers to the FreeFounders role builder. */
  @Public()
  @Get('permissions')
  async permissions(@Req() req: AuthedRequest) {
    await this.requireService(req);
    const group = new Map(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p, g.label] as const)));
    return {
      app: 'assets',
      scopes: [],
      // The CEO-only leadership page is the one thing the Admin role does not get (ADMIN_PERMISSIONS).
      permissions: ALL_PERMISSIONS.map((key) => ({
        key,
        label: PERMISSIONS[key],
        group: group.get(key) ?? 'Other',
        description: PERMISSION_HINTS[key],
        scopes: null,
        superAdminOnly: !(ADMIN_PERMISSIONS as readonly string[]).includes(key),
      })),
    };
  }

  /** The company's roles and who holds them, so an existing company can be brought into the role builder. */
  @Public()
  @Get('access')
  async exportAccess(@Req() req: AuthedRequest) {
    await this.requireService(req);
    const db = this.dbs.db;
    const roleRows = await db.select().from(roles).orderBy(asc(roles.createdAt));
    const people = await db
      .select({ personId: users.platformPersonId, userId: users.id, roleName: roles.name, extra: sql<string[]>`(select coalesce(array_agg(r2.name order by r2.name), '{}') from user_roles ur join roles r2 on r2.id = ur.role_id where ur.user_id = ${users.id})` })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(isNotNull(users.platformPersonId));
    return {
      version: await this.accessVersion(),
      roles: roleRows.map((r) => ({
        code: r.name,
        name: r.name,
        description: r.description,
        archived: r.archived,
        system: r.isSystem,
        platformRoleId: r.platformRoleId,
        grants: r.permissions.map((permission) => ({ permission, scope: '' })),
      })),
      people: people.map((p) => ({ personId: p.personId, userId: p.userId, roles: p.extra.length ? p.extra : [p.roleName] })),
    };
  }

  /**
   * The Platform's full role set for the company, plus the roles of the listed people. Roles are matched by their
   * Platform id, else by name; roles the Platform no longer sends are archived. Older versions are ignored.
   */
  @Public()
  @Put('access')
  async importAccess(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(accessSchema).transform(raw);
    const valid = new Set<string>(ALL_PERMISSIONS);
    return this.dbs.tx(async (db) => {
      const current = await this.accessVersion();
      if (input.version < current) return { version: current, applied: false };
      const problems: string[] = [];
      const byPlatformId = new Map<string, string>();
      for (const r of input.roles) {
        const permissions = [
          ...new Set(
            r.grants
              .filter((g) => (g.app ?? 'assets') === 'assets')
              .filter((g) => (valid.has(g.permission) ? true : (problems.push(`${r.name}: ${g.permission} is not an Assets permission`), false)))
              .map((g) => g.permission),
          ),
        ];
        const [byId] = await db.select().from(roles).where(eq(roles.platformRoleId, r.id)).limit(1);
        // Not linked yet: the role it was imported from (its original name is the code), else one with the same name.
        const localName = r.code?.startsWith('assets:') ? r.code.slice('assets:'.length) : r.name;
        const existing =
          byId ??
          (await db.select().from(roles).where(and(sql`lower(${roles.name}) = lower(${localName})`, sql`${roles.platformRoleId} is null`)).limit(1))[0] ??
          (await db.select().from(roles).where(and(sql`lower(${roles.name}) = lower(${r.name})`, sql`${roles.platformRoleId} is null`)).limit(1))[0];
        const values = { name: r.name, description: r.description ?? null, permissions, archived: r.archived ?? false, platformRoleId: r.id, updatedAt: new Date() };
        if (existing) {
          // Another local role already has this name: keep both by marking the Platform's copy.
          const [clash] = await db.select({ id: roles.id }).from(roles).where(and(sql`lower(${roles.name}) = lower(${r.name})`, ne(roles.id, existing.id))).limit(1);
          await db.update(roles).set(clash ? { ...values, name: `${r.name} (FreeFounders)` } : values).where(eq(roles.id, existing.id));
          byPlatformId.set(r.id, existing.id);
        } else {
          const [created] = await db.insert(roles).values({ ...values, isSystem: false }).returning({ id: roles.id });
          byPlatformId.set(r.id, created.id);
        }
      }
      if (input.complete !== false) {
        const keep = [...byPlatformId.keys()];
        await db
          .update(roles)
          .set({ archived: true, updatedAt: new Date() })
          .where(and(isNotNull(roles.platformRoleId), keep.length ? notInArray(roles.platformRoleId, keep) : sql`true`));
      }
      const missingPeople: string[] = [];
      for (const p of input.people) {
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.platformPersonId, p.personId)).limit(1);
        if (!user) {
          missingPeople.push(p.personId);
          continue;
        }
        await db.delete(userRoles).where(eq(userRoles.userId, user.id));
        const roleIds = p.roleIds.map((id) => byPlatformId.get(id)).filter((id): id is string => Boolean(id));
        if (roleIds.length) await db.insert(userRoles).values(roleIds.map((roleId) => ({ userId: user.id, roleId }))).onConflictDoNothing();
        // Permissions changed: sessions built on the old ones end (the web app gets a new one from its token).
        await db.delete(sessions).where(eq(sessions.userId, user.id));
      }
      await db
        .insert(syncState)
        .values({ key: ACCESS_VERSION_KEY, value: String(input.version) })
        .onConflictDoUpdate({ target: syncState.key, set: { value: String(input.version) } });
      return { version: input.version, applied: true, roles: byPlatformId.size, people: input.people.length - missingPeople.length, missingPeople, problems };
    });
  }

  private async accessVersion(): Promise<number> {
    const [row] = await this.dbs.db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, ACCESS_VERSION_KEY)).limit(1);
    return row ? Number(row.value) || 0 : 0;
  }

  private async requireService(req: AuthedRequest) {
    const token = bearerToken(req.headers.authorization);
    const claims = token ? await verifyPlatformToken(token, SERVICE_AUDIENCE) : null;
    if (!claims || claims.sub !== 'platform') throw new UnauthorizedException('Platform service token required');
  }

  private async findOrCreate(input: ProvisionInput) {
    const db = this.dbs.db;
    const [linked] = await db.select({ id: users.id }).from(users).where(eq(users.platformPersonId, input.personId)).for('update');
    if (linked) return { userId: linked.id, created: false };

    const match =
      (input.employeeCode
        ? (
            await db
              .select({ user: users })
              .from(users)
              .innerJoin(employees, eq(employees.id, users.employeeId))
              .where(sql`lower(${employees.employeeCode}) = lower(${input.employeeCode})`)
              .limit(1)
          )[0]?.user
        : undefined) ??
      (input.email ? (await db.select().from(users).where(sql`lower(${users.email}) = lower(${input.email})`).limit(1))[0] : undefined) ??
      (input.username ? (await db.select().from(users).where(sql`lower(${users.username}) = lower(${input.username})`).limit(1))[0] : undefined);

    if (match) {
      if (match.platformPersonId && match.platformPersonId !== input.personId) {
        throw new ConflictException(`The Assets login "${match.username ?? match.email ?? match.name}" already belongs to another person`);
      }
      await db.update(users).set({ platformPersonId: input.personId, updatedAt: new Date() }).where(eq(users.id, match.id));
      return { userId: match.id, created: false };
    }

    const [role] = input.appRole
      ? await db.select().from(roles).where(sql`lower(${roles.name}) = lower(${input.appRole})`).limit(1)
      : // No role chosen: the company's FreeFounders owners/admins run Assets too. Once the role builder has synced,
        // the built-in role carries its role-builder name ("Employee (Assets)"); the person's real permissions
        // come from the roles the Platform sends right after.
        await db
          .select()
          .from(roles)
          .where(
            sql`lower(${roles.name}) in (${sql.join(
              (input.platformRole === 'owner' || input.platformRole === 'admin' ? ['Admin'] : ['Employee']).flatMap((n) => [n.toLowerCase(), `${n.toLowerCase()} (assets)`]).map((n) => sql`${n}`),
              sql`, `,
            )})`,
          )
          .orderBy(sql`${roles.isSystem} desc`, sql`${roles.archived} asc`)
          .limit(1);
    if (!role) throw badRequest(input.appRole ? `No Assets role called "${input.appRole}"` : 'The Employee role is missing');

    // Everyone with a login is on the employee list, except leadership (same rule as adding a user in Admin).
    let employeeId: string | null = null;
    if (input.employeeCode) {
      const [emp] = await db
        .select({ id: employees.id, userId: users.id })
        .from(employees)
        .leftJoin(users, eq(users.employeeId, employees.id))
        .where(sql`lower(${employees.employeeCode}) = lower(${input.employeeCode})`)
        .limit(1);
      if (emp && !emp.userId) employeeId = emp.id;
    }
    if (!employeeId && !role.permissions.includes('insights:leadership')) {
      employeeId = await this.addStaffEmployee(input);
    }

    // Keep a login ID or email only if nobody else here uses it; they sign in through the Platform anyway.
    const [emailTaken] = input.email ? await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${input.email})`).limit(1) : [];
    const [nameTaken] = input.username
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.username}) = lower(${input.username})`)
          .limit(1)
      : [];
    const [codeClash] = input.username
      ? await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.employeeCode}) = lower(${input.username}) and ${employees.id} is distinct from ${employeeId}`).limit(1)
      : [];

    const [row] = await db
      .insert(users)
      .values({
        name: input.fullName,
        email: emailTaken ? null : (input.email ?? null),
        username: nameTaken || codeClash ? null : (input.username ?? null),
        // No local password: an unguessable hash nobody knows. Sign-in is through the Platform only.
        passwordHash: await hash(randomBytes(32).toString('base64url')),
        roleId: role.id,
        employeeId,
        platformPersonId: input.personId,
      })
      .returning({ id: users.id, name: users.name, email: users.email });
    await this.history.record(PLATFORM_ACTOR, {
      entityType: 'USER',
      entityId: row.id,
      entityLabel: row.email ?? row.name,
      action: 'CREATED',
      summary: `User ${row.email ?? row.name} created from FreeFounders Platform`,
    });
    return { userId: row.id, created: true };
  }

  private async addStaffEmployee(input: ProvisionInput): Promise<string> {
    const db = this.dbs.db;
    let code = input.employeeCode ?? null;
    if (code) {
      const [taken] = await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.employeeCode}) = lower(${code})`).limit(1);
      if (taken) code = null; // used by an employee who already has a login: give this person a staff code
    }
    const employeeCode = code ?? (await this.sequences.next('STAFF', 3));
    const [emailTaken] = input.email ? await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.email}) = lower(${input.email})`).limit(1) : [];
    const [firstName, ...rest] = input.fullName.trim().split(/\s+/);
    const [emp] = await db
      .insert(employees)
      .values({
        employeeCode,
        firstName,
        lastName: rest.join(' ') || null,
        email: emailTaken ? null : (input.email ?? null),
        phone: input.mobile ?? null,
        companyId: await this.dbs.defaultCompanyId(),
      })
      .returning({ id: employees.id, fullName: employees.fullName });
    await this.history.record(PLATFORM_ACTOR, {
      entityType: 'EMPLOYEE',
      entityId: emp.id,
      entityLabel: emp.fullName,
      employeeId: emp.id,
      action: 'CREATED',
      summary: `${emp.fullName} (${employeeCode}) added with their FreeFounders login`,
    });
    return emp.id;
  }
}
