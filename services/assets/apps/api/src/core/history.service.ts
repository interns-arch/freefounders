import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { HistoryEntityType } from '@eam/shared';
import type { Actor } from '../common/actor';
import { likePattern, type ListParams, type Page } from '../common/http';
import { DbService } from '../db/db.service';
import { type FieldChange, historyEvents } from '../db/schema';

export interface HistoryInput {
  entityType: HistoryEntityType;
  entityId: string;
  entityLabel?: string | null;
  action: string;
  summary: string;
  changes?: FieldChange[] | null;
  assetId?: string | null;
  employeeId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface HistoryFilter {
  entityType?: string;
  entityId?: string;
  assetId?: string;
  employeeId?: string;
  action?: string[];
  from?: string;
  to?: string;
}

function normalise(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/**
 * Compares `before` with the fields present in `patch` and returns what changed.
 * `labels` maps field names to human labels for the timeline.
 */
export function diffChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  labels: Record<string, string> = {},
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const from = normalise(before[field]);
    const to = normalise(value);
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field, label: labels[field], from, to });
    }
  }
  return changes;
}

/** Writes to the append-only history table (the database blocks UPDATE / DELETE). */
@Injectable()
export class HistoryService {
  constructor(private readonly dbs: DbService) {}

  async record(actor: Actor, input: HistoryInput): Promise<void> {
    await this.recordMany(actor, [input]);
  }

  async recordMany(actor: Actor, inputs: HistoryInput[]): Promise<void> {
    if (!inputs.length) return;
    await this.dbs.db.insert(historyEvents).values(
      inputs.map((i) => ({
        actorId: actor.userId,
        actorName: actor.name,
        entityType: i.entityType,
        entityId: i.entityId,
        entityLabel: i.entityLabel ?? null,
        action: i.action,
        summary: i.summary,
        changes: i.changes?.length ? i.changes : null,
        assetId: i.assetId ?? (i.entityType === 'ASSET' ? i.entityId : null),
        employeeId: i.employeeId ?? (i.entityType === 'EMPLOYEE' ? i.entityId : null),
        metadata: i.metadata ?? null,
      })),
    );
  }

  async list(filter: HistoryFilter, params: Pick<ListParams, 'offset' | 'pageSize' | 'page' | 'search'>): Promise<Page<typeof historyEvents.$inferSelect>> {
    const conds: SQL[] = [];
    if (filter.entityType) conds.push(eq(historyEvents.entityType, filter.entityType));
    if (filter.entityId) conds.push(eq(historyEvents.entityId, filter.entityId));
    if (filter.assetId) conds.push(eq(historyEvents.assetId, filter.assetId));
    if (filter.employeeId) conds.push(eq(historyEvents.employeeId, filter.employeeId));
    if (filter.action?.length) conds.push(inArray(historyEvents.action, filter.action));
    if (filter.from) conds.push(gte(historyEvents.occurredAt, new Date(`${filter.from}T00:00:00`)));
    if (filter.to) conds.push(lte(historyEvents.occurredAt, new Date(`${filter.to}T23:59:59.999`)));
    if (params.search) {
      const p = likePattern(params.search);
      conds.push(or(ilike(historyEvents.summary, p), ilike(historyEvents.entityLabel, p), ilike(historyEvents.actorName, p))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const db = this.dbs.db;
    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(historyEvents)
        .where(where)
        .orderBy(desc(historyEvents.occurredAt), desc(historyEvents.id))
        .limit(params.pageSize)
        .offset(params.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(historyEvents).where(where),
    ]);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }
}
