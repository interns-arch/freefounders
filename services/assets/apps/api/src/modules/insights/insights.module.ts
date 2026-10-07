import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { type Actor, can } from '../../common/actor';
import { CurrentActor, likePattern, RequirePermissions, today } from '../../common/http';
import { DbService } from '../../db/db.service';
import {
  assetCategories,
  assetRequests,
  assets,
  assetTypes,
  departments,
  employees,
  exitCases,
  historyEvents,
  locations,
  tickets,
  vendors,
} from '../../db/schema';
import { AssetsModule } from '../assets/assets.module';
import { normaliseCode } from '../../common/codes';
import { AssetsService } from '../assets/assets.service';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeesService } from '../employees/employees.service';
import { LeadershipService } from './leadership.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly dbs: DbService,
    private readonly assets: AssetsService,
    private readonly employees: EmployeesService,
  ) {}

  /** One query box for everything the user is allowed to see. */
  async search(actor: Actor, raw: string) {
    const q = raw.trim().slice(0, 200);
    if (!q) return { exact: null, assets: [], employees: [], departments: [], locations: [], vendors: [], assetTypes: [] };
    const like = likePattern(q);
    const db = this.dbs.db;
    const code = normaliseCode(q);

    const [exact, assetPage, employeePage, depts, locs, vends, types] = await Promise.all([
      this.assets.lookup(actor, code).catch(() => null),
      this.assets.list(actor, { search: q, pageSize: '6' }),
      can(actor, 'employee:view') ? this.employees.list(actor, { search: q, pageSize: '5', includeExited: '1' }) : Promise.resolve({ items: [] }),
      db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).where(or(ilike(departments.name, like), ilike(departments.code, like))).orderBy(asc(departments.name)).limit(3),
      db.select({ id: locations.id, name: locations.name, code: locations.code, isStore: locations.isStore }).from(locations).where(or(ilike(locations.name, like), ilike(locations.code, like))).orderBy(asc(locations.name)).limit(3),
      db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(ilike(vendors.name, like)).orderBy(asc(vendors.name)).limit(3),
      db
        .select({ id: assetTypes.id, name: assetTypes.name, icon: assetTypes.icon, categoryName: assetCategories.name })
        .from(assetTypes)
        .innerJoin(assetCategories, eq(assetCategories.id, assetTypes.categoryId))
        .where(or(ilike(assetTypes.name, like), ilike(assetCategories.name, like)))
        .orderBy(asc(assetTypes.name))
        .limit(4),
    ]);
    return {
      exact,
      assets: assetPage.items,
      employees: employeePage.items,
      departments: depts,
      locations: locs,
      vendors: vends,
      assetTypes: types,
    };
  }
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly dbs: DbService,
    private readonly employees: EmployeesService,
  ) {}

  async summary(actor: Actor) {
    if (!can(actor, 'dashboard:view')) return this.personal(actor);
    const db = this.dbs.db;
    const now = today();
    const [byStatus, byCategory, byHolder, expiring, exits, counts, activity, byType] = await Promise.all([
      db.select({ status: assets.status, count: sql<number>`count(*)::int`, units: sql<number>`sum(${assets.quantity})::int` }).from(assets).groupBy(assets.status),
      db
        .select({
          id: assetCategories.id,
          name: assetCategories.name,
          icon: assetCategories.icon,
          color: assetCategories.color,
          count: sql<number>`count(${assets.id})::int`,
          assigned: sql<number>`count(${assets.id}) filter (where ${assets.status} = 'ASSIGNED')::int`,
        })
        .from(assetCategories)
        .leftJoin(assets, and(eq(assets.categoryId, assetCategories.id), sql`${assets.status} <> 'DISPOSED'`))
        .groupBy(assetCategories.id)
        .orderBy(desc(sql`count(${assets.id})`), asc(assetCategories.sortOrder)),
      db
        .select({ holderType: sql<string>`al.holder_type`, count: sql<number>`count(distinct al.asset_id)::int` })
        .from(sql`allocations al`)
        .where(sql`al.status = 'ACTIVE'`)
        .groupBy(sql`al.holder_type`),
      db
        .select({ id: assets.id, assetTag: assets.assetTag, name: assets.name, warrantyExpiry: assets.warrantyExpiry, holderName: assets.holderName })
        .from(assets)
        .where(and(sql`${assets.warrantyExpiry} between ${now}::date and ${now}::date + 30`, sql`${assets.status} not in ('DISPOSED', 'RETIRED')`))
        .orderBy(asc(assets.warrantyExpiry))
        .limit(6),
      db
        .select({
          id: exitCases.id,
          caseNumber: exitCases.caseNumber,
          lastWorkingDate: exitCases.lastWorkingDate,
          employeeName: employees.fullName,
          employeeId: employees.id,
          total: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id)`,
          pending: sql<number>`(select count(*)::int from exit_items i where i.exit_case_id = exit_cases.id and i.status in ('PENDING', 'MISSING'))`,
        })
        .from(exitCases)
        .innerJoin(employees, eq(employees.id, exitCases.employeeId))
        .where(eq(exitCases.status, 'OPEN'))
        .orderBy(asc(exitCases.lastWorkingDate))
        .limit(6),
      db.execute<{
        employees: number;
        on_notice: number;
        pending_requests: number;
        approved_requests: number;
        open_tickets: number;
        in_maintenance: number;
        warranty_expiring: number;
        exit_pending_items: number;
      }>(sql`select
          (select count(*)::int from employees where status not in ('EXITED', 'JOINING')) as employees,
          (select count(*)::int from employees where status = 'NOTICE_PERIOD') as on_notice,
          (select count(*)::int from asset_requests where status = 'PENDING') as pending_requests,
          (select count(*)::int from asset_requests where status = 'APPROVED') as approved_requests,
          (select count(*)::int from tickets where status in ('OPEN', 'IN_PROGRESS')) as open_tickets,
          (select count(*)::int from maintenance_records where status = 'IN_PROGRESS') as in_maintenance,
          (select count(*)::int from assets where warranty_expiry between ${now}::date and ${now}::date + 30 and status not in ('DISPOSED', 'RETIRED')) as warranty_expiring,
          (select count(*)::int from exit_items i join exit_cases c on c.id = i.exit_case_id where c.status = 'OPEN' and i.status in ('PENDING', 'MISSING')) as exit_pending_items`),
      db
        .select({
          id: historyEvents.id,
          occurredAt: historyEvents.occurredAt,
          actorName: historyEvents.actorName,
          entityType: historyEvents.entityType,
          entityId: historyEvents.entityId,
          entityLabel: historyEvents.entityLabel,
          action: historyEvents.action,
          summary: historyEvents.summary,
          assetId: historyEvents.assetId,
        })
        .from(historyEvents)
        .orderBy(desc(historyEvents.occurredAt), desc(historyEvents.id))
        .limit(12),
      db
        .select({
          id: assetTypes.id,
          name: assetTypes.name,
          icon: assetTypes.icon,
          available: sql<number>`count(*) filter (where ${assets.status} = 'AVAILABLE')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(assets)
        .innerJoin(assetTypes, eq(assetTypes.id, assets.assetTypeId))
        .where(sql`${assets.status} <> 'DISPOSED'`)
        .groupBy(assetTypes.id)
        .orderBy(desc(sql`count(*)`))
        .limit(8),
    ]);
    const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s.count]));
    const total = byStatus.reduce((n, s) => n + (s.status === 'DISPOSED' ? 0 : s.count), 0);
    const c = counts.rows[0];
    return {
      scope: 'organisation' as const,
      totals: {
        assets: total,
        assigned: statusMap.ASSIGNED ?? 0,
        available: statusMap.AVAILABLE ?? 0,
        inMaintenance: statusMap.IN_MAINTENANCE ?? 0,
        lost: statusMap.LOST ?? 0,
        employees: c.employees,
        onNotice: c.on_notice,
        pendingRequests: c.pending_requests,
        approvedRequests: c.approved_requests,
        openTickets: c.open_tickets,
        warrantyExpiring: c.warranty_expiring,
        exitPendingItems: c.exit_pending_items,
      },
      byStatus: statusMap,
      byCategory,
      byHolder: Object.fromEntries(byHolder.map((h) => [h.holderType, h.count])),
      byType,
      expiring,
      exits,
      activity,
    };
  }

  private async personal(actor: Actor) {
    const db = this.dbs.db;
    const myAssets = actor.employeeId ? await this.employees.assets(actor, actor.employeeId) : [];
    const [requests, myTickets, exit] = await Promise.all([
      actor.employeeId
        ? db
            .select({
              id: assetRequests.id,
              number: assetRequests.number,
              status: assetRequests.status,
              createdAt: assetRequests.createdAt,
              quantity: assetRequests.quantity,
              decisionNote: assetRequests.decisionNote,
              typeName: sql<string>`coalesce(${assetTypes.name}, ${assetRequests.itemName})`,
            })
            .from(assetRequests)
            .leftJoin(assetTypes, eq(assetTypes.id, assetRequests.assetTypeId))
            .where(eq(assetRequests.employeeId, actor.employeeId))
            .orderBy(desc(assetRequests.createdAt))
            .limit(10)
        : [],
      db
        .select({ id: tickets.id, number: tickets.number, title: tickets.title, status: tickets.status, createdAt: tickets.createdAt })
        .from(tickets)
        .where(eq(tickets.reportedBy, actor.userId!))
        .orderBy(desc(tickets.createdAt))
        .limit(5),
      actor.employeeId
        ? db
            .select({ id: exitCases.id, caseNumber: exitCases.caseNumber, lastWorkingDate: exitCases.lastWorkingDate })
            .from(exitCases)
            .where(and(eq(exitCases.employeeId, actor.employeeId), eq(exitCases.status, 'OPEN')))
        : [],
    ]);
    return { scope: 'personal' as const, myAssets, requests, tickets: myTickets, openExit: exit[0] ?? null };
  }
}

@Controller()
export class InsightsController {
  constructor(
    private readonly searchService: SearchService,
    private readonly dashboard: DashboardService,
    private readonly leadership: LeadershipService,
  ) {}

  @Get('search')
  search(@CurrentActor() actor: Actor, @Query('q') q = '') {
    return this.searchService.search(actor, q);
  }

  @Get('dashboard')
  summary(@CurrentActor() actor: Actor) {
    return this.dashboard.summary(actor);
  }

  @Get('leadership')
  @RequirePermissions('insights:leadership')
  overview(@Query('days') days?: string) {
    return this.leadership.overview(days);
  }
}

@Module({
  imports: [AssetsModule, EmployeesModule],
  providers: [SearchService, DashboardService, LeadershipService],
  controllers: [InsightsController],
})
export class InsightsModule {}
