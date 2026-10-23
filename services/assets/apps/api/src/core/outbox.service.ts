import { Injectable } from '@nestjs/common';
import { asc, gt, lt } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { ffEvents } from '../db/schema';
import { platformEnabled } from '../modules/auth/platform-token';

/**
 * Events for the Kaampilot Platform (PLAN.md §17.4). Written in the same transaction as the change they
 * describe; the Platform reads them with GET /api/internal/events and runs its cross-app rules. Nothing is
 * written in a standalone install.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly dbs: DbService) {}

  async emit(type: string, payload: Record<string, unknown>) {
    if (!platformEnabled()) return;
    await this.dbs.db.insert(ffEvents).values({ type, payload });
  }

  /** Events after `after` (oldest first). Events older than 30 days are cleared on the way. */
  async after(after: number, limit = 200) {
    await this.dbs.db.delete(ffEvents).where(lt(ffEvents.createdAt, new Date(Date.now() - 30 * 86_400_000)));
    return this.dbs.db.select().from(ffEvents).where(gt(ffEvents.id, after)).orderBy(asc(ffEvents.id)).limit(limit);
  }
}
