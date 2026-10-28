// The employee record a Kaampilot Platform person gets in Assets (PLAN.md §13, §26): made when the Platform opens Assets
// for them (/internal/provision) or, for a login that has none yet, by the People push (/internal/people).
import { sql } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import type { HistoryService } from '../../core/history.service';
import type { SequenceService } from '../../core/sequence.service';
import type { DbService } from '../../db/db.service';
import { employees } from '../../db/schema';

export const PLATFORM_ACTOR: Actor = { userId: null, name: 'Kaampilot Platform', email: null, employeeId: null, roleName: 'System', permissions: new Set() };

export interface StaffInput {
  fullName: string;
  email?: string | null;
  mobile?: string | null;
  employeeCode?: string | null;
}

/** Splits "First Middle Last" the way Assets stores it (first word, the rest). */
export function splitName(fullName: string): { firstName: string; lastName: string | null } {
  const [firstName, ...rest] = fullName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') || null };
}

/** Adds the employee (their own code if free, else the next STAFF code; an email another employee has is left out). */
export async function addStaffEmployee(deps: { dbs: DbService; sequences: SequenceService; history: HistoryService }, input: StaffInput): Promise<string> {
  const db = deps.dbs.db;
  let code = input.employeeCode ?? null;
  if (code) {
    const [taken] = await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.employeeCode}) = lower(${code})`).limit(1);
    if (taken) code = null; // used by an employee who already has a login: give this person a staff code
  }
  const employeeCode = code ?? (await deps.sequences.next('STAFF', 3));
  const [emailTaken] = input.email ? await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.email}) = lower(${input.email})`).limit(1) : [];
  const [emp] = await db
    .insert(employees)
    .values({
      employeeCode,
      ...splitName(input.fullName),
      email: emailTaken ? null : (input.email ?? null),
      phone: input.mobile ?? null,
      companyId: await deps.dbs.defaultCompanyId(),
    })
    .returning({ id: employees.id, fullName: employees.fullName });
  await deps.history.record(PLATFORM_ACTOR, {
    entityType: 'EMPLOYEE',
    entityId: emp.id,
    entityLabel: emp.fullName,
    employeeId: emp.id,
    action: 'CREATED',
    summary: `${emp.fullName} (${employeeCode}) added with their Kaampilot login`,
  });
  return emp.id;
}
