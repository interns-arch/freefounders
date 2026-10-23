// Delete a person (Admin -> People & access -> "Delete user"), called by the Kaampilot Platform:
// DELETE /api/internal/people/:personId. Runs in ONE transaction in the company schema the request is pinned to
// (multi-company mode), so either all of it happens or nothing does. Photo files on disk of deleted rows are removed
// after the transaction has committed.
//
// Optional JSON body (the founder's choices; no body = {"assets": {"mode": "stock"}, "history": {"mode": "delete"}}):
//   "assets":  {"mode": "stock"} | {"mode": "hand_over", "to": "<platform person id>"}
//   "history": {"mode": "delete"} | {"mode": "keep"}
//   ("tasks" and "leads" belong to the Tasks app and are ignored here.)
// `to` must be an active login here, linked to that platform person, with an employee record that has not exited, and
// not the person being deleted; otherwise 400 before anything changes.
//
// Response: {"deleted": true, "anonymised": bool, "counts": {table: n}, "handed_over": {"tasks": 0, "leads": 0, "assets": n}}
//           | {"deleted": false} when there is no such person here (the Platform may retry).
//
// The person = the `users` row with this platform_person_id (U) and its linked `employees` row (E, may be absent).
//
// Assets they hold now (ACTIVE allocations of E; individually tracked assets whose holder is E):
//   stock      returned to stock, never deleted: individually tracked -> AVAILABLE (IN_MAINTENANCE stays and comes
//              back AVAILABLE when the job ends), holder cleared; quantity-tracked -> units back to available_quantity.
//              No history is written about it. (history keep: the allocation is closed as RETURNED, not deleted.)
//   hand_over  like a transfer: the allocation is closed as TRANSFERRED and the receiver gets a new ACTIVE allocation
//              (same quantity); the asset's holder becomes the receiver; a history event "Handed over from <name>
//              (deleted)" is written for the receiver.
//
// history "delete" -- everything about them goes ("delete everything", the founder's first decision):
//   allocations.employee_id = E           DELETE (custody history; their photos cascade; exit/onboarding items -> NULL)
//   exit_cases / onboarding_cases / asset_requests of E   DELETE (+ items, cascade)
//   tickets.reporter_employee_id = E / reported_by = U   DELETE (tickets have no comment/attachment tables)
//   maintenance_records.created_by = U    DELETE (an asset left IN_MAINTENANCE by an open job of theirs goes back to
//                                         service the way finishing the job would: ASSIGNED / IN_INVENTORY / AVAILABLE)
//   history_events about them             DELETE: employee_id = E, entity EMPLOYEE E / USER U, or entity = a deleted
//                                         request / ticket / exit case / onboarding case / maintenance row.
//   ff_events (outbox) about them         DELETE: payload employeeId = E, personIds contains them, ticketId deleted
//   uuid "by" columns = U on rows that stay -> NULL (and their *_by_name copy -> NULL)
// history "keep" -- their records stay, pointing at an anonymised employee row:
//   employees E                           ANONYMISED: name "Deleted user", employee code DELETED-<id> (so provision can
//                                         never match it again), email/phones/notes blank, manager cleared, status
//                                         EXITED (exit date kept or today); the holder name on its allocations and the
//                                         label of its history events become "Deleted user". Free-text summaries
//                                         written in the past are left as they are.
//   open exit cases / open onboarding cases / pending or approved requests of E   CANCELLED
//   history_events                        kept; actor_id = U -> NULL, actor_name "Deleted user"
//   ff_events about them                  DELETE (payload employeeId = E or personIds contains them)
//   uuid "by" columns = U                 -> NULL, their *_by_name copy -> "Deleted user"
// Both modes:
//   sessions, user_roles, notifications of U, and the users row U   DELETE (no login, no platform link remains)
//   employees.manager_id = E -> NULL      tickets.assignee_id = U -> NULL
//   uuid "by" columns: assets.created_by, allocations.assigned_by / ended_by, allocation_photos.uploaded_by,
//   ownership_records.recorded_by, exit_cases.initiated_by, asset_requests.requested_by, onboarding_cases.created_by,
//   reconciliation_runs.created_by (and, in keep mode, tickets.reported_by / maintenance_records.created_by).
//   Name-only copies with no id (decided_by_name, resolved_by_name, approved_by_name, ...) cannot be matched to the
//   person reliably and are left as they are.
// history_events is append-only by trigger; the trigger is switched off for this transaction only.
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Executor } from '../../db/db.service';
import {
  allocationPhotos,
  allocations,
  assetRequests,
  assets,
  employees,
  exitCases,
  ffEvents,
  historyEvents,
  maintenanceRecords,
  notifications,
  onboardingCases,
  ownershipRecords,
  reconciliationRuns,
  sessions,
  tickets,
  userRoles,
  users,
} from '../../db/schema';
import { uploadDir } from '../assets/photos.service';

const PLATFORM = 'Kaampilot Platform';
const DELETED = 'Deleted user';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A body that cannot be applied (bad shape or hand-over target); nothing has been changed. */
export class DeleteOptionsError extends Error {}

export interface DeleteOptions {
  assets: { mode: 'stock' } | { mode: 'hand_over'; to: string };
  history: { mode: 'delete' | 'keep' };
}

export function parseDeleteOptions(raw: unknown): DeleteOptions {
  const body = raw ?? {};
  if (typeof body !== 'object' || Array.isArray(body)) throw new DeleteOptionsError('The body must be a JSON object');
  const { assets: a, history: h } = body as Record<string, unknown>;
  const opts: DeleteOptions = { assets: { mode: 'stock' }, history: { mode: 'delete' } };
  if (a !== undefined && a !== null) {
    const mode = (a as { mode?: unknown }).mode;
    if (typeof a !== 'object' || (mode !== 'stock' && mode !== 'hand_over')) throw new DeleteOptionsError('assets.mode must be one of: stock, hand_over');
    if (mode === 'hand_over') {
      const to = String((a as { to?: unknown }).to ?? '');
      if (!UUID_RE.test(to)) throw new DeleteOptionsError('assets.to must be a platform person id (UUID)');
      opts.assets = { mode: 'hand_over', to: to.toLowerCase() };
    }
  }
  if (h !== undefined && h !== null) {
    const mode = (h as { mode?: unknown }).mode;
    if (typeof h !== 'object' || (mode !== 'delete' && mode !== 'keep')) throw new DeleteOptionsError('history.mode must be one of: delete, keep');
    opts.history = { mode };
  }
  return opts;
}

export type DeleteResult =
  | { deleted: false }
  | { deleted: true; anonymised: boolean; counts: Record<string, number>; handed_over: { tasks: number; leads: number; assets: number } };

export async function deletePerson(db: Executor, personId: string, opts: DeleteOptions = parseDeleteOptions(undefined)): Promise<{ result: DeleteResult; files: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.platformPersonId, personId)).for('update');
  if (!user) return { result: { deleted: false }, files: [] };
  const U = user.id;
  const E = user.employeeId;
  const keep = opts.history.mode === 'keep';
  const counts: Record<string, number> = {};
  const add = (table: string, n: number) => {
    if (n) counts[table] = (counts[table] ?? 0) + n;
  };
  const files: string[] = [];
  const handed = { tasks: 0, leads: 0, assets: 0 };

  // 0. The hand-over receiver is checked before anything changes.
  let receiver: { employeeId: string; name: string } | null = null;
  if (opts.assets.mode === 'hand_over') {
    if (opts.assets.to === personId.toLowerCase()) throw new DeleteOptionsError('Assets cannot be handed over to the person being deleted');
    const [to] = await db
      .select({ isActive: users.isActive, employeeId: users.employeeId, name: users.name, empName: employees.fullName, empStatus: employees.status })
      .from(users)
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(eq(users.platformPersonId, opts.assets.to));
    if (!to) throw new DeleteOptionsError('Assets: the person to hand over to has no Assets access');
    if (!to.isActive) throw new DeleteOptionsError(`Assets: the person to hand over to (${to.name}) is not active`);
    if (!to.employeeId || to.empStatus === 'EXITED') throw new DeleteOptionsError(`Assets: the person to hand over to (${to.name}) has no current employee record to hold assets`);
    receiver = { employeeId: to.employeeId, name: to.empName ?? to.name };
  }
  const [emp] = E ? await db.select({ fullName: employees.fullName }).from(employees).where(eq(employees.id, E)) : [];
  const personName = emp?.fullName || user.name;

  if (E) {
    // 1. What they hold: to the receiver, or back to stock.
    const held = await db
      .select({ alloc: allocations, assetTag: assets.assetTag, assetName: assets.name, trackingMode: assets.trackingMode })
      .from(allocations)
      .innerJoin(assets, eq(assets.id, allocations.assetId))
      .where(and(eq(allocations.employeeId, E), eq(allocations.status, 'ACTIVE')));
    if (receiver) {
      const now = new Date();
      for (const h of held) {
        await db
          .update(allocations)
          .set({ status: 'TRANSFERRED', endedAt: now, endedByName: PLATFORM, endNotes: `Handed over to ${receiver.name} (person deleted)` })
          .where(eq(allocations.id, h.alloc.id));
        const [alloc] = await db
          .insert(allocations)
          .values({
            assetId: h.alloc.assetId,
            holderType: 'EMPLOYEE',
            employeeId: receiver.employeeId,
            holderName: receiver.name,
            quantity: h.alloc.quantity,
            exclusive: h.alloc.exclusive,
            assignedAt: now,
            assignedByName: PLATFORM,
            notes: `Handed over from ${personName} (deleted)`,
          })
          .returning({ id: allocations.id });
        if (h.trackingMode === 'INDIVIDUAL') {
          await db
            .update(assets)
            .set({ holderType: 'EMPLOYEE', holderId: receiver.employeeId, holderName: receiver.name, assignedAt: now, version: sql`${assets.version} + 1`, updatedAt: now })
            .where(eq(assets.id, h.alloc.assetId));
        }
        await db.insert(historyEvents).values({
          actorName: PLATFORM,
          entityType: 'ASSET',
          entityId: h.alloc.assetId,
          entityLabel: `${h.assetTag} · ${h.assetName}`,
          action: 'TRANSFERRED',
          summary: `${h.trackingMode === 'QUANTITY' ? `${h.alloc.quantity} × ` : ''}Handed over from ${personName} (deleted) to ${receiver.name}`,
          assetId: h.alloc.assetId,
          employeeId: receiver.employeeId,
          metadata: { toAllocationId: alloc.id },
        });
      }
      handed.assets = held.length;
    } else {
      for (const h of held.filter((x) => x.trackingMode === 'QUANTITY')) {
        await db
          .update(assets)
          .set({ availableQuantity: sql`least(${assets.quantity}, ${assets.availableQuantity} + ${h.alloc.quantity})`, status: 'AVAILABLE', version: sql`${assets.version} + 1`, updatedAt: new Date() })
          .where(eq(assets.id, h.alloc.assetId));
      }
      add('assets_returned_to_stock', new Set(held.filter((h) => h.trackingMode === 'QUANTITY').map((h) => h.alloc.assetId)).size);
      if (keep && held.length) {
        await db
          .update(allocations)
          .set({ status: 'RETURNED', endedAt: new Date(), endedByName: PLATFORM, endNotes: 'Returned to stock: person deleted' })
          .where(inArray(allocations.id, held.map((h) => h.alloc.id)));
      }
    }
    // Individually tracked assets still showing them as holder (with or without an allocation) go back to stock.
    const returned = await db
      .update(assets)
      .set({
        status: sql`case when ${assets.status} = 'ASSIGNED' then 'AVAILABLE' else ${assets.status} end`,
        holderType: null,
        holderId: null,
        holderName: null,
        assignedAt: null,
        version: sql`${assets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(assets.trackingMode, 'INDIVIDUAL'), eq(assets.holderType, 'EMPLOYEE'), eq(assets.holderId, E)))
      .returning({ id: assets.id });
    add('assets_returned_to_stock', returned.length);
  }

  await db.execute(sql`alter table history_events disable trigger history_events_no_update_delete`);
  if (keep) await keepHistory(db, E, personId, add);
  else await deleteHistory(db, U, E, personId, add, files);
  await db.update(historyEvents).set({ actorId: null, actorName: DELETED }).where(eq(historyEvents.actorId, U));
  await db.execute(sql`alter table history_events enable trigger history_events_no_update_delete`);

  // Their id on rows that stay (and, when history is kept, "Deleted user" where a name copy sits next to it).
  const nameCopy = keep ? DELETED : null;
  await db.update(assets).set({ createdBy: null }).where(eq(assets.createdBy, U));
  await db.update(allocations).set({ assignedBy: null, assignedByName: nameCopy }).where(eq(allocations.assignedBy, U));
  await db.update(allocations).set({ endedBy: null, endedByName: nameCopy }).where(eq(allocations.endedBy, U));
  await db.update(allocationPhotos).set({ uploadedBy: null, uploadedByName: nameCopy }).where(eq(allocationPhotos.uploadedBy, U));
  await db.update(ownershipRecords).set({ recordedBy: null }).where(eq(ownershipRecords.recordedBy, U));
  await db.update(exitCases).set({ initiatedBy: null, initiatedByName: nameCopy }).where(eq(exitCases.initiatedBy, U));
  await db.update(assetRequests).set({ requestedBy: null, requestedByName: nameCopy }).where(eq(assetRequests.requestedBy, U));
  await db.update(onboardingCases).set({ createdBy: null, createdByName: nameCopy }).where(eq(onboardingCases.createdBy, U));
  await db.update(reconciliationRuns).set({ createdBy: null, createdByName: nameCopy }).where(eq(reconciliationRuns.createdBy, U));
  await db.update(tickets).set({ reportedBy: null, reportedByName: DELETED }).where(eq(tickets.reportedBy, U));
  await db.update(maintenanceRecords).set({ createdBy: null, createdByName: DELETED }).where(eq(maintenanceRecords.createdBy, U));
  await db.update(tickets).set({ assigneeId: null }).where(eq(tickets.assigneeId, U));
  if (E) await db.update(employees).set({ managerId: null }).where(eq(employees.managerId, E));

  // The login always goes; the employee record goes or is anonymised.
  add('sessions', (await db.delete(sessions).where(eq(sessions.userId, U)).returning({ id: sessions.id })).length);
  add('user_roles', (await db.delete(userRoles).where(eq(userRoles.userId, U)).returning({ userId: userRoles.userId })).length);
  add('notifications', (await db.delete(notifications).where(eq(notifications.userId, U)).returning({ id: notifications.id })).length);
  add('users', (await db.delete(users).where(eq(users.id, U)).returning({ id: users.id })).length);
  if (E && keep) {
    await db
      .update(employees)
      .set({
        firstName: 'Deleted',
        lastName: 'user',
        employeeCode: `DELETED-${E.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
        email: null,
        phone: null,
        personalEmail: null,
        personalPhone: null,
        notes: null,
        managerId: null,
        status: 'EXITED',
        exitDate: sql`coalesce(${employees.exitDate}, current_date)`,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, E));
    add('employees_anonymised', 1);
  } else if (E) {
    add('employees', (await db.delete(employees).where(eq(employees.id, E)).returning({ id: employees.id })).length);
  }

  return { result: { deleted: true, anonymised: keep, counts, handed_over: handed }, files };
}

/** history "delete": every row about them goes (the trigger on history_events is off while this runs). */
async function deleteHistory(db: Executor, U: string, E: string | null, personId: string, add: (t: string, n: number) => void, files: string[]) {
  const allocIds = E ? (await db.select({ id: allocations.id }).from(allocations).where(eq(allocations.employeeId, E))).map((r) => r.id) : [];
  if (allocIds.length) {
    const photos = await db
      .select({ fileName: allocationPhotos.fileName })
      .from(allocationPhotos)
      .where(and(inArray(allocationPhotos.allocationId, allocIds), isNull(allocationPhotos.data)));
    files.push(...photos.map((p) => path.join(uploadDir(), p.fileName)));
    add('allocation_photos', (await db.delete(allocationPhotos).where(inArray(allocationPhotos.allocationId, allocIds)).returning({ id: allocationPhotos.id })).length);
  }
  const exitIds = E ? (await db.delete(exitCases).where(eq(exitCases.employeeId, E)).returning({ id: exitCases.id })).map((r) => r.id) : [];
  add('exit_cases', exitIds.length);
  const onboardingIds = E ? (await db.delete(onboardingCases).where(eq(onboardingCases.employeeId, E)).returning({ id: onboardingCases.id })).map((r) => r.id) : [];
  add('onboarding_cases', onboardingIds.length);
  add('allocations', allocIds.length ? (await db.delete(allocations).where(inArray(allocations.id, allocIds)).returning({ id: allocations.id })).length : 0);
  const requestIds = E ? (await db.delete(assetRequests).where(eq(assetRequests.employeeId, E)).returning({ id: assetRequests.id })).map((r) => r.id) : [];
  add('asset_requests', requestIds.length);
  const ticketIds = (
    await db
      .delete(tickets)
      .where(E ? or(eq(tickets.reportedBy, U), eq(tickets.reporterEmployeeId, E)) : eq(tickets.reportedBy, U))
      .returning({ id: tickets.id })
  ).map((r) => r.id);
  add('tickets', ticketIds.length);
  const maintenance = await db
    .delete(maintenanceRecords)
    .where(eq(maintenanceRecords.createdBy, U))
    .returning({ id: maintenanceRecords.id, assetId: maintenanceRecords.assetId, status: maintenanceRecords.status });
  add('maintenance_records', maintenance.length);
  for (const assetId of [...new Set(maintenance.filter((m) => m.status === 'IN_PROGRESS').map((m) => m.assetId))]) {
    const [open] = await db
      .select({ id: maintenanceRecords.id })
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.assetId, assetId), eq(maintenanceRecords.status, 'IN_PROGRESS')))
      .limit(1);
    if (open) continue;
    const [active] = await db
      .select({ holderType: allocations.holderType })
      .from(allocations)
      .where(and(eq(allocations.assetId, assetId), eq(allocations.status, 'ACTIVE')))
      .limit(1);
    const next = active ? (active.holderType === 'INVENTORY' ? 'IN_INVENTORY' : 'ASSIGNED') : 'AVAILABLE';
    await db
      .update(assets)
      .set({ status: next, version: sql`${assets.version} + 1`, updatedAt: new Date() })
      .where(and(eq(assets.id, assetId), eq(assets.status, 'IN_MAINTENANCE')));
  }

  const deletedEntities = [...requestIds, ...ticketIds, ...exitIds, ...onboardingIds, ...maintenance.map((m) => m.id)];
  const about = or(
    ...(E ? [eq(historyEvents.employeeId, E), and(eq(historyEvents.entityType, 'EMPLOYEE'), eq(historyEvents.entityId, E))] : []),
    and(eq(historyEvents.entityType, 'USER'), eq(historyEvents.entityId, U)),
    ...(deletedEntities.length ? [inArray(historyEvents.entityId, deletedEntities)] : []),
  );
  add('history_events', (await db.delete(historyEvents).where(about).returning({ id: historyEvents.id })).length);

  const outbox = await db
    .delete(ffEvents)
    .where(
      or(
        ...(E ? [sql`${ffEvents.payload}->>'employeeId' = ${E}`] : []),
        sql`coalesce(${ffEvents.payload}->'personIds', '[]'::jsonb) ? ${personId}`,
        ...(ticketIds.length ? [sql`${ffEvents.payload}->>'ticketId' in (${sql.join(ticketIds.map((id) => sql`${id}`), sql`, `)})`] : []),
      ),
    )
    .returning({ id: ffEvents.id });
  add('ff_events', outbox.length);
}

/** history "keep": records stay; open work is cancelled and the name is taken out of the structured columns. */
async function keepHistory(db: Executor, E: string | null, personId: string, add: (t: string, n: number) => void) {
  if (E) {
    const now = new Date();
    add('exit_cases_cancelled', (await db.update(exitCases).set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now }).where(and(eq(exitCases.employeeId, E), eq(exitCases.status, 'OPEN'))).returning({ id: exitCases.id })).length);
    add(
      'onboarding_cases_cancelled',
      (
        await db
          .update(onboardingCases)
          .set({ status: 'CANCELLED', cancelledAt: now, cancelReason: 'Person deleted', updatedAt: now })
          .where(and(eq(onboardingCases.employeeId, E), inArray(onboardingCases.status, ['DRAFT', 'SUBMITTED', 'APPROVED'])))
          .returning({ id: onboardingCases.id })
      ).length,
    );
    add(
      'asset_requests_cancelled',
      (
        await db
          .update(assetRequests)
          .set({ status: 'CANCELLED', decisionNote: 'Person deleted', updatedAt: now })
          .where(and(eq(assetRequests.employeeId, E), inArray(assetRequests.status, ['PENDING', 'APPROVED'])))
          .returning({ id: assetRequests.id })
      ).length,
    );
    await db.update(allocations).set({ holderName: DELETED }).where(eq(allocations.employeeId, E));
    await db.update(historyEvents).set({ entityLabel: DELETED }).where(and(eq(historyEvents.entityType, 'EMPLOYEE'), eq(historyEvents.entityId, E)));
  }
  const outbox = await db
    .delete(ffEvents)
    .where(or(...(E ? [sql`${ffEvents.payload}->>'employeeId' = ${E}`] : []), sql`coalesce(${ffEvents.payload}->'personIds', '[]'::jsonb) ? ${personId}`))
    .returning({ id: ffEvents.id });
  add('ff_events', outbox.length);
}

/** After the commit: photo files of deleted rows (older photos live on disk; newer ones in the database). */
export async function removeFiles(files: string[]) {
  await Promise.all(files.map((f) => unlink(f).catch(() => undefined)));
}
