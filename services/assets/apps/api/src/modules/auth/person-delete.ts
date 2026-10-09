// Delete a person completely (Admin -> People & access -> "Delete user completely"), called by the FreeFounders
// Platform: DELETE /api/internal/people/:personId. The founder decided "delete everything": the person's login, their
// employee record and every record about them go, even when reports for past months change. Cannot be undone.
// Runs in ONE transaction in the company schema the request is pinned to (multi-company mode), so either all of it
// goes or nothing does. Photo files on disk of deleted rows are removed after the transaction has committed.
//
// The person = the `users` row with this platform_person_id (U) and its linked `employees` row (E, may be absent).
//
// Per relation (FKs in schema.ts / drizzle/*.sql, plus the uuid columns that hold a user id without an FK):
//   assets held by E (ACTIVE allocations, assets.holder = E)  RETURNED TO STOCK, not deleted: individually tracked ->
//                                         status AVAILABLE (IN_MAINTENANCE stays, it comes back AVAILABLE when the
//                                         job ends), holder cleared; quantity-tracked -> units back to available_quantity.
//                                         No history is written about it.
//   allocations.employee_id = E           DELETE (all custody history; their photos cascade; exit/onboarding items -> NULL)
//   exit_cases.employee_id = E            DELETE (+ exit_items, cascade)
//   onboarding_cases.employee_id = E      DELETE (+ onboarding_items, cascade)
//   asset_requests.employee_id = E        DELETE
//   tickets.reporter_employee_id = E / reported_by = U   DELETE (tickets have no comment/attachment tables)
//   maintenance_records.created_by = U    DELETE (an asset left IN_MAINTENANCE by an open job of theirs goes back to
//                                         service the way finishing the job would: ASSIGNED / IN_INVENTORY / AVAILABLE)
//   history_events about them             DELETE: employee_id = E, entity EMPLOYEE E / USER U, or entity = a deleted
//                                         request / ticket / exit case / onboarding case / maintenance row. The table is
//                                         append-only by trigger; the trigger is switched off for this transaction only.
//   history_events.actor_id = U (other entities)   NULL actor_id, actor_name 'Deleted user'
//   ff_events (outbox) about them         DELETE: payload employeeId = E, personIds contains them, ticketId deleted
//   sessions, user_roles, notifications (user_id = U)   DELETE
//   users U, employees E                  DELETE
//   employees.manager_id = E              NULL (FK on delete set null)   tickets.assignee_id = U   NULL
//   uuid "by" columns = U on rows that stay: assets.created_by, allocations.assigned_by / ended_by,
//   allocation_photos.uploaded_by, ownership_records.recorded_by, exit_cases.initiated_by, asset_requests.requested_by,
//   onboarding_cases.created_by, reconciliation_runs.created_by -> NULL (and their *_by_name copy -> NULL).
//   Name-only copies with no id (decided_by_name, resolved_by_name, approved_by_name, ...) cannot be matched to the
//   person reliably and are left as they are.
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

export type DeleteResult = { deleted: false } | { deleted: true; counts: Record<string, number> };

export async function deletePerson(db: Executor, personId: string): Promise<{ result: DeleteResult; files: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.platformPersonId, personId)).for('update');
  if (!user) return { result: { deleted: false }, files: [] };
  const U = user.id;
  const E = user.employeeId;
  const counts: Record<string, number> = {};
  const add = (table: string, n: number) => {
    if (n) counts[table] = (counts[table] ?? 0) + n;
  };
  const files: string[] = [];

  if (E) {
    // 1. What they hold goes back to stock.
    const held = await db
      .select({ id: allocations.id, assetId: allocations.assetId, quantity: allocations.quantity, trackingMode: assets.trackingMode })
      .from(allocations)
      .innerJoin(assets, eq(assets.id, allocations.assetId))
      .where(and(eq(allocations.employeeId, E), eq(allocations.status, 'ACTIVE')));
    for (const a of held.filter((h) => h.trackingMode === 'QUANTITY')) {
      await db
        .update(assets)
        .set({ availableQuantity: sql`least(${assets.quantity}, ${assets.availableQuantity} + ${a.quantity})`, status: 'AVAILABLE', version: sql`${assets.version} + 1`, updatedAt: new Date() })
        .where(eq(assets.id, a.assetId));
    }
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
      .where(
        and(
          eq(assets.trackingMode, 'INDIVIDUAL'),
          or(and(eq(assets.holderType, 'EMPLOYEE'), eq(assets.holderId, E)), ...(held.length ? [inArray(assets.id, held.map((h) => h.assetId))] : [])),
        ),
      )
      .returning({ id: assets.id });
    add('assets_returned_to_stock', returned.length + new Set(held.filter((h) => h.trackingMode === 'QUANTITY').map((h) => h.assetId)).size);
  }

  // 2. Rows about them, collected first so history / outbox / files can follow.
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
  const maintenance = await db.delete(maintenanceRecords).where(eq(maintenanceRecords.createdBy, U)).returning({ id: maintenanceRecords.id, assetId: maintenanceRecords.assetId, status: maintenanceRecords.status });
  add('maintenance_records', maintenance.length);
  const stuck = [...new Set(maintenance.filter((m) => m.status === 'IN_PROGRESS').map((m) => m.assetId))];
  for (const assetId of stuck) {
    const [open] = await db.select({ id: maintenanceRecords.id }).from(maintenanceRecords).where(and(eq(maintenanceRecords.assetId, assetId), eq(maintenanceRecords.status, 'IN_PROGRESS'))).limit(1);
    if (open) continue;
    const [active] = await db.select({ holderType: allocations.holderType }).from(allocations).where(and(eq(allocations.assetId, assetId), eq(allocations.status, 'ACTIVE'))).limit(1);
    const next = active ? (active.holderType === 'INVENTORY' ? 'IN_INVENTORY' : 'ASSIGNED') : 'AVAILABLE';
    await db
      .update(assets)
      .set({ status: next, version: sql`${assets.version} + 1`, updatedAt: new Date() })
      .where(and(eq(assets.id, assetId), eq(assets.status, 'IN_MAINTENANCE')));
  }

  // 3. History about them goes; history they only acted in keeps the event without them. The table refuses edits
  //    by trigger; it is switched off inside this transaction only (ALTER TABLE is transactional in Postgres).
  const deletedEntities = [...requestIds, ...ticketIds, ...exitIds, ...onboardingIds, ...maintenance.map((m) => m.id)];
  await db.execute(sql`alter table history_events disable trigger history_events_no_update_delete`);
  const about = or(
    ...(E ? [eq(historyEvents.employeeId, E), and(eq(historyEvents.entityType, 'EMPLOYEE'), eq(historyEvents.entityId, E))] : []),
    and(eq(historyEvents.entityType, 'USER'), eq(historyEvents.entityId, U)),
    ...(deletedEntities.length ? [inArray(historyEvents.entityId, deletedEntities)] : []),
  );
  add('history_events', (await db.delete(historyEvents).where(about).returning({ id: historyEvents.id })).length);
  await db.update(historyEvents).set({ actorId: null, actorName: 'Deleted user' }).where(eq(historyEvents.actorId, U));
  await db.execute(sql`alter table history_events enable trigger history_events_no_update_delete`);

  // 4. Outbox rows about them.
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

  // 5. Their id on rows that stay.
  await db.update(assets).set({ createdBy: null }).where(eq(assets.createdBy, U));
  await db.update(allocations).set({ assignedBy: null, assignedByName: null }).where(eq(allocations.assignedBy, U));
  await db.update(allocations).set({ endedBy: null, endedByName: null }).where(eq(allocations.endedBy, U));
  await db.update(allocationPhotos).set({ uploadedBy: null, uploadedByName: null }).where(eq(allocationPhotos.uploadedBy, U));
  await db.update(ownershipRecords).set({ recordedBy: null }).where(eq(ownershipRecords.recordedBy, U));
  await db.update(exitCases).set({ initiatedBy: null, initiatedByName: null }).where(eq(exitCases.initiatedBy, U));
  await db.update(assetRequests).set({ requestedBy: null, requestedByName: null }).where(eq(assetRequests.requestedBy, U));
  await db.update(onboardingCases).set({ createdBy: null, createdByName: null }).where(eq(onboardingCases.createdBy, U));
  await db.update(reconciliationRuns).set({ createdBy: null, createdByName: null }).where(eq(reconciliationRuns.createdBy, U));
  await db.update(tickets).set({ assigneeId: null }).where(eq(tickets.assigneeId, U));
  if (E) await db.update(employees).set({ managerId: null }).where(eq(employees.managerId, E));

  // 6. The login and the employee record.
  add('sessions', (await db.delete(sessions).where(eq(sessions.userId, U)).returning({ id: sessions.id })).length);
  add('user_roles', (await db.delete(userRoles).where(eq(userRoles.userId, U)).returning({ userId: userRoles.userId })).length);
  add('notifications', (await db.delete(notifications).where(eq(notifications.userId, U)).returning({ id: notifications.id })).length);
  add('users', (await db.delete(users).where(eq(users.id, U)).returning({ id: users.id })).length);
  if (E) add('employees', (await db.delete(employees).where(eq(employees.id, E)).returning({ id: employees.id })).length);

  return { result: { deleted: true, counts }, files };
}

/** After the commit: photo files of deleted rows (older photos live on disk; newer ones in the database). */
export async function removeFiles(files: string[]) {
  await Promise.all(files.map((f) => unlink(f).catch(() => undefined)));
}
