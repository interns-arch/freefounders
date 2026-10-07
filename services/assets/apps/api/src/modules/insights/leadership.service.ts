import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';

const PERIODS = [7, 30, 90, 365] as const;

/**
 * The CEO view: how the organisation and the IT team are doing over a period.
 * Numbers come straight from the register and the append-only history.
 */
@Injectable()
export class LeadershipService {
  constructor(private readonly dbs: DbService) {}

  async overview(rawDays: string | undefined) {
    const days = PERIODS.find((p) => String(p) === rawDays) ?? 30;
    const since = sql`now() - make_interval(days => ${days})`;
    const db = this.dbs.db;

    const [headline, service, team, departments] = await Promise.all([
      db.execute<{
        headcount: number;
        joiners: number;
        leavers: number;
        upcoming_joiners: number;
        on_notice: number;
        assets_in_use: number;
        assets_available: number;
      }>(sql`select
          (select count(*)::int from employees where status in ('ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD')) as headcount,
          (select count(*)::int from employees where status <> 'JOINING' and join_date >= (${since})::date) as joiners,
          (select count(*)::int from exit_cases where status = 'COMPLETED' and completed_at >= ${since}) as leavers,
          (select count(*)::int from onboarding_cases where status in ('DRAFT', 'SUBMITTED', 'APPROVED')) as upcoming_joiners,
          (select count(*)::int from employees where status = 'NOTICE_PERIOD') as on_notice,
          (select count(*)::int from assets where status = 'ASSIGNED') as assets_in_use,
          (select count(*)::int from assets where status = 'AVAILABLE') as assets_available`),
      db.execute<{
        tickets_opened: number;
        tickets_resolved: number;
        tickets_open: number;
        tickets_stale: number;
        avg_resolution_hours: number | null;
        requests_raised: number;
        requests_fulfilled: number;
        requests_waiting: number;
        avg_fulfil_days: number | null;
        handovers: number;
        exits_completed: number;
        items_recovered: number;
        items_written_off: number;
        onboardings_completed: number;
        onboardings_on_time: number;
      }>(sql`select
          (select count(*)::int from tickets where created_at >= ${since}) as tickets_opened,
          (select count(*)::int from tickets where resolved_at >= ${since}) as tickets_resolved,
          (select count(*)::int from tickets where status in ('OPEN', 'IN_PROGRESS')) as tickets_open,
          (select count(*)::int from tickets where status in ('OPEN', 'IN_PROGRESS') and created_at < now() - interval '7 days') as tickets_stale,
          (select round(avg(extract(epoch from resolved_at - created_at) / 3600)::numeric, 1)::float from tickets where resolved_at >= ${since}) as avg_resolution_hours,
          (select count(*)::int from asset_requests where created_at >= ${since}) as requests_raised,
          (select count(*)::int from asset_requests where fulfilled_at >= ${since}) as requests_fulfilled,
          (select count(*)::int from asset_requests where status in ('PENDING', 'APPROVED')) as requests_waiting,
          (select round(avg(extract(epoch from fulfilled_at - created_at) / 86400)::numeric, 1)::float from asset_requests where fulfilled_at >= ${since}) as avg_fulfil_days,
          (select count(*)::int from history_events where entity_type = 'ASSET' and action in ('ASSIGNED', 'TRANSFERRED', 'ISSUED') and occurred_at >= ${since}) as handovers,
          (select count(*)::int from exit_cases where status = 'COMPLETED' and completed_at >= ${since}) as exits_completed,
          (select count(*)::int from exit_items where status in ('RETURNED', 'DAMAGED') and resolved_at >= ${since}) as items_recovered,
          (select count(*)::int from exit_items where status = 'MISSING' and resolved_at >= ${since}) as items_written_off,
          (select count(*)::int from onboarding_cases where status = 'COMPLETED' and completed_at >= ${since}) as onboardings_completed,
          (select count(*)::int from onboarding_cases where status = 'COMPLETED' and completed_at >= ${since} and completed_at::date <= join_date) as onboardings_on_time`),
      // The IT team: active users whose role handles tickets or custody (not view-only roles).
      db.execute<{
        id: string;
        name: string;
        role_name: string;
        tickets_resolved: number;
        tickets_open: number;
        avg_resolution_hours: number | null;
        handovers: number;
        returns: number;
        requests_fulfilled: number;
        onboarding_items: number;
        last_active: string | null;
      }>(sql`select u.id, u.name, r.name as role_name,
          (select count(*)::int from tickets t where t.assignee_id = u.id and t.resolved_at >= ${since}) as tickets_resolved,
          (select count(*)::int from tickets t where t.assignee_id = u.id and t.status in ('OPEN', 'IN_PROGRESS')) as tickets_open,
          (select round(avg(extract(epoch from t.resolved_at - t.created_at) / 3600)::numeric, 1)::float from tickets t where t.assignee_id = u.id and t.resolved_at >= ${since}) as avg_resolution_hours,
          (select count(*)::int from history_events h where h.actor_id = u.id and h.entity_type = 'ASSET' and h.action in ('ASSIGNED', 'TRANSFERRED', 'ISSUED') and h.occurred_at >= ${since}) as handovers,
          (select count(*)::int from history_events h where h.actor_id = u.id and h.entity_type = 'ASSET' and h.action = 'RETURNED' and h.occurred_at >= ${since}) as returns,
          (select count(*)::int from history_events h where h.actor_id = u.id and h.entity_type = 'REQUEST' and h.action = 'FULFILLED' and h.occurred_at >= ${since}) as requests_fulfilled,
          (select count(*)::int from history_events h where h.actor_id = u.id and h.entity_type = 'ONBOARDING_CASE' and h.action = 'ITEM_ISSUED' and h.occurred_at >= ${since}) as onboarding_items,
          (select max(h.occurred_at) from history_events h where h.actor_id = u.id) as last_active
        from users u
        join roles r on r.id = u.role_id
        where u.is_active
          and r.permissions && array['ticket:manage', 'asset:assign']::text[]
          and r.name not in ('Leadership', 'Employee')
        order by u.name`),
      db.execute<{ id: string; name: string; headcount: number; on_notice: number; assets_held: number; pending_recovery: number }>(sql`select d.id, d.name,
          (select count(*)::int from employees e where e.department_id = d.id and e.status in ('ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD')) as headcount,
          (select count(*)::int from employees e where e.department_id = d.id and e.status = 'NOTICE_PERIOD') as on_notice,
          (select count(distinct al.asset_id)::int from allocations al join employees e on e.id = al.employee_id where e.department_id = d.id and al.status = 'ACTIVE') as assets_held,
          (select count(*)::int from exit_items i join exit_cases c on c.id = i.exit_case_id join employees e on e.id = c.employee_id where e.department_id = d.id and c.status = 'OPEN' and i.status in ('PENDING', 'MISSING')) as pending_recovery
        from departments d
        order by d.name`),
    ]);

    const h = headline.rows[0];
    const s = service.rows[0];
    return {
      days,
      headline: {
        headcount: h.headcount,
        joiners: h.joiners,
        leavers: h.leavers,
        upcomingJoiners: h.upcoming_joiners,
        onNotice: h.on_notice,
        assetsInUse: h.assets_in_use,
        assetsAvailable: h.assets_available,
      },
      service: {
        ticketsOpened: s.tickets_opened,
        ticketsResolved: s.tickets_resolved,
        ticketsOpen: s.tickets_open,
        ticketsStale: s.tickets_stale,
        avgResolutionHours: s.avg_resolution_hours,
        requestsRaised: s.requests_raised,
        requestsFulfilled: s.requests_fulfilled,
        requestsWaiting: s.requests_waiting,
        avgFulfilDays: s.avg_fulfil_days,
        handovers: s.handovers,
        exitsCompleted: s.exits_completed,
        itemsRecovered: s.items_recovered,
        itemsWrittenOff: s.items_written_off,
        onboardingsCompleted: s.onboardings_completed,
        onboardingsOnTime: s.onboardings_on_time,
      },
      team: team.rows.map((r) => ({
        id: r.id,
        name: r.name,
        roleName: r.role_name,
        ticketsResolved: r.tickets_resolved,
        ticketsOpen: r.tickets_open,
        avgResolutionHours: r.avg_resolution_hours,
        handovers: r.handovers,
        returns: r.returns,
        requestsFulfilled: r.requests_fulfilled,
        onboardingItems: r.onboarding_items,
        lastActive: r.last_active,
      })),
      departments: departments.rows
        .map((d) => ({ id: d.id, name: d.name, headcount: d.headcount, onNotice: d.on_notice, assetsHeld: d.assets_held, pendingRecovery: d.pending_recovery }))
        .filter((d) => d.headcount || d.assetsHeld),
    };
  }
}
