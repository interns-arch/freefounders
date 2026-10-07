import { Body, ConflictException, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor } from '../../common/actor';
import { type AuthedRequest, badRequest, Public, ZodPipe } from '../../common/http';
import { HistoryService } from '../../core/history.service';
import { SequenceService } from '../../core/sequence.service';
import { DbService } from '../../db/db.service';
import { employees, roles, users } from '../../db/schema';
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
});
type ProvisionInput = z.infer<typeof provisionSchema>;

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
  ) {}

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
    const rows = await this.dbs.db.select({ name: roles.name, description: roles.description }).from(roles).orderBy(asc(roles.name));
    return rows.map((r) => ({ value: r.name, label: r.name, description: r.description }));
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
      : await db.select().from(roles).where(eq(roles.name, 'Employee')).limit(1);
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
