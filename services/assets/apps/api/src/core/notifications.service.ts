import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Permission } from '@eam/shared';
import type { Actor } from '../common/actor';
import { DbService } from '../db/db.service';
import { notifications, roles, users } from '../db/schema';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** In-app notifications. The UI polls the unread count and shows new ones as toasts. */
@Injectable()
export class NotificationsService {
  constructor(private readonly dbs: DbService) {}

  async notifyUsers(userIds: string[], n: NotificationInput): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return;
    await this.dbs.db.insert(notifications).values(
      unique.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })),
    );
  }

  /** Notifies every active user whose role grants `permission` (e.g. IT/Admin for `exit:manage`). */
  async notifyPermission(permission: Permission, n: NotificationInput, excludeUserId?: string | null): Promise<void> {
    const rows = await this.dbs.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.isActive, true), sql`${permission} = any(${roles.permissions})`));
    await this.notifyUsers(
      rows.map((r) => r.id).filter((id) => id !== excludeUserId),
      n,
    );
  }

  /** Notifies the login linked to an employee, if they have one. */
  async notifyEmployee(employeeId: string, n: NotificationInput): Promise<void> {
    const rows = await this.dbs.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.employeeId, employeeId), eq(users.isActive, true)));
    await this.notifyUsers(
      rows.map((r) => r.id),
      n,
    );
  }

  async list(actor: Actor) {
    if (!actor.userId) return { items: [], unread: 0 };
    const db = this.dbs.db;
    const [items, [{ unread }]] = await Promise.all([
      db.select().from(notifications).where(eq(notifications.userId, actor.userId)).orderBy(desc(notifications.createdAt)).limit(40),
      db
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))),
    ]);
    return { items, unread };
  }

  async markRead(actor: Actor, ids?: string[]): Promise<void> {
    if (!actor.userId) return;
    const conds = [eq(notifications.userId, actor.userId), isNull(notifications.readAt)];
    if (ids?.length) conds.push(inArray(notifications.id, ids));
    await this.dbs.db.update(notifications).set({ readAt: new Date() }).where(and(...conds));
  }
}
