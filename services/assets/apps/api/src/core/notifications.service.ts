import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Permission } from '@eam/shared';
import type { Actor } from '../common/actor';
import { DbService } from '../db/db.service';
import { notifications, users } from '../db/schema';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * The area a notification is grouped under in the bell (PLAN.md §19.37): "approvals" for what waits for this person's
 * decision (a new request, a new joiner for IT), "assets" for everything else here. Decided by the type, which every
 * row has, so old rows group the same way (no column needed).
 */
export type NotificationCategory = 'assets' | 'approvals';
export const APPROVAL_TYPES = ['REQUEST_CREATED', 'ONBOARDING_SUBMITTED'] as const;
export const categoryOf = (type: string): NotificationCategory => ((APPROVAL_TYPES as readonly string[]).includes(type) ? 'approvals' : 'assets');
const inCategory = (category: NotificationCategory) =>
  category === 'approvals' ? inArray(notifications.type, [...APPROVAL_TYPES]) : notInArray(notifications.type, [...APPROVAL_TYPES]);

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
      .where(and(eq(users.isActive, true), sql`${permission} = any(user_permissions(${users.id}))`));
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

  /** The latest 40 (of one area with `category`), each with its area, the unread total and the unread per area. */
  async list(actor: Actor, category?: NotificationCategory) {
    const empty = { assets: 0, approvals: 0 };
    if (!actor.userId) return { items: [], unread: 0, unreadByCategory: empty };
    const db = this.dbs.db;
    const mine = eq(notifications.userId, actor.userId);
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(category ? and(mine, inCategory(category)) : mine)
        .orderBy(desc(notifications.createdAt))
        .limit(40),
      db
        .select({ type: notifications.type, n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(mine, isNull(notifications.readAt)))
        .groupBy(notifications.type),
    ]);
    const unreadByCategory = { ...empty };
    for (const c of counts) unreadByCategory[categoryOf(c.type)] += c.n;
    return {
      items: rows.map((r) => ({ ...r, category: categoryOf(r.type) })),
      unread: unreadByCategory.assets + unreadByCategory.approvals,
      unreadByCategory,
    };
  }

  /** Marks read: the given ids, else one area (`category`), else everything. */
  async markRead(actor: Actor, ids?: string[], category?: NotificationCategory): Promise<void> {
    if (!actor.userId) return;
    const conds = [eq(notifications.userId, actor.userId), isNull(notifications.readAt)];
    if (ids?.length) conds.push(inArray(notifications.id, ids));
    else if (category) conds.push(inCategory(category));
    await this.dbs.db.update(notifications).set({ readAt: new Date() }).where(and(...conds));
  }
}
