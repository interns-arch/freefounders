import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Req, UnauthorizedException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthedRequest, Public, ZodPipe } from '../../common/http';
import { DbService } from '../../db/db.service';
import { departments, employees, sessions, syncState, users } from '../../db/schema';
import { deletePerson, removeFiles } from './person-delete';
import { bearerToken, SERVICE_AUDIENCE, verifyPlatformToken } from './platform-token';

const PEOPLE_VERSION_KEY = 'ff_people_version';

const peopleSchema = z.object({
  version: z.number().int().min(0),
  departments: z.array(z.object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(120), active: z.boolean().optional() })),
  people: z.array(
    z.object({
      personId: z.string().uuid(),
      status: z.enum(['active', 'inactive']).optional(),
      departmentCode: z.string().max(40).nullable().optional(),
      designation: z.string().max(120).nullable().optional(),
      reportsTo: z.string().uuid().nullable().optional(),
      joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }),
  ),
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);

/**
 * The People directory from the FreeFounders Platform (PLAN.md §17.1): the company's departments, and each linked
 * person's department, manager, designation, join date and active/inactive. Internal: Platform service token only.
 */
@Controller('internal/people')
export class InternalPeopleController {
  constructor(private readonly dbs: DbService) {}

  private async requireService(req: AuthedRequest) {
    const token = bearerToken(req.headers.authorization);
    const claims = token ? await verifyPlatformToken(token, SERVICE_AUDIENCE) : null;
    if (!claims || claims.sub !== 'platform') throw new UnauthorizedException('Platform service token required');
  }

  /** Departments and each linked person's department / manager / designation / join date (existing company, first sync). */
  @Public()
  @Get()
  async export(@Req() req: AuthedRequest) {
    await this.requireService(req);
    const db = this.dbs.db;
    const depts = await db.select().from(departments);
    const rows = await db
      .select({
        personId: users.platformPersonId,
        departmentId: employees.departmentId,
        designation: employees.designation,
        joinDate: employees.joinDate,
        managerPerson: sql<string | null>`(select u2.platform_person_id from users u2 where u2.employee_id = ${employees.managerId} and u2.platform_person_id is not null limit 1)`,
      })
      .from(users)
      .innerJoin(employees, eq(employees.id, users.employeeId))
      .where(isNotNull(users.platformPersonId));
    const codeOf = new Map(depts.map((d) => [d.id, d.code || slug(d.name)]));
    return {
      departments: depts.map((d) => ({ code: d.code || slug(d.name), name: d.name, active: true })),
      people: rows.map((r) => ({
        personId: r.personId,
        departmentCode: r.departmentId ? (codeOf.get(r.departmentId) ?? null) : null,
        designation: r.designation,
        reportsTo: r.managerPerson,
        joinDate: r.joinDate,
      })),
    };
  }

  @Public()
  @Put()
  async import(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(peopleSchema).transform(raw);
    return this.dbs.tx(async (db) => {
      const [row] = await db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, PEOPLE_VERSION_KEY)).limit(1);
      const current = row ? Number(row.value) || 0 : 0;
      if (input.version < current) return { version: current, applied: false };

      // Departments: matched by code, else by name (then given the code); new ones are added.
      const deptId = new Map<string, string>();
      const companyId = await this.dbs.defaultCompanyId();
      for (const d of input.departments) {
        const [byCode] = await db.select().from(departments).where(eq(departments.code, d.code)).limit(1);
        const [byName] = byCode ? [byCode] : await db.select().from(departments).where(sql`lower(${departments.name}) = lower(${d.name})`).limit(1);
        if (byName) {
          await db.update(departments).set({ name: d.name, code: d.code, updatedAt: new Date() }).where(eq(departments.id, byName.id));
          deptId.set(d.code, byName.id);
        } else {
          const [created] = await db.insert(departments).values({ name: d.name, code: d.code, companyId }).returning({ id: departments.id });
          deptId.set(d.code, created.id);
        }
      }

      const ids = [...new Set(input.people.flatMap((p) => [p.personId, ...(p.reportsTo ? [p.reportsTo] : [])]))];
      const linked = ids.length
        ? await db.select({ id: users.id, personId: users.platformPersonId, employeeId: users.employeeId, isActive: users.isActive }).from(users).where(inArray(users.platformPersonId, ids))
        : [];
      const byPerson = new Map(linked.map((u) => [u.personId!, u]));
      const missingPeople: string[] = [];
      for (const p of input.people) {
        const user = byPerson.get(p.personId);
        if (!user) {
          missingPeople.push(p.personId);
          continue;
        }
        const active = (p.status ?? 'active') === 'active';
        if (user.isActive !== active) {
          await db.update(users).set({ isActive: active, updatedAt: new Date() }).where(eq(users.id, user.id));
          if (!active) await db.delete(sessions).where(eq(sessions.userId, user.id)); // signed out at once
        }
        if (!user.employeeId) continue; // e.g. Leadership logins have no employee record
        const manager = p.reportsTo ? byPerson.get(p.reportsTo) : undefined;
        await db
          .update(employees)
          .set({
            ...(p.departmentCode !== undefined ? { departmentId: p.departmentCode ? (deptId.get(p.departmentCode) ?? null) : null } : {}),
            ...(p.designation !== undefined ? { designation: p.designation } : {}),
            ...(p.joinDate ? { joinDate: p.joinDate } : {}),
            ...(p.reportsTo !== undefined ? { managerId: manager?.employeeId && manager.employeeId !== user.employeeId ? manager.employeeId : null } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(employees.id, user.employeeId)));
      }
      await db
        .insert(syncState)
        .values({ key: PEOPLE_VERSION_KEY, value: String(input.version) })
        .onConflictDoUpdate({ target: syncState.key, set: { value: String(input.version) } });
      return { version: input.version, applied: true, people: input.people.length - missingPeople.length, missingPeople };
    });
  }

  /**
   * Delete this person completely (Admin -> People & access): the login, the employee record and everything about
   * them; assets they hold go back to stock. 200 {deleted:false} when there is no such person here. See person-delete.ts.
   */
  @Public()
  @Delete(':personId')
  async remove(@Req() req: AuthedRequest, @Param('personId') personId: string) {
    await this.requireService(req);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) throw new BadRequestException('personId must be a UUID');
    const { result, files } = await this.dbs.tx((db) => deletePerson(db, personId.toLowerCase()));
    await removeFiles(files);
    return result;
  }
}
