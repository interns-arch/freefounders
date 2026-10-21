import { HttpException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { DbService } from '../db/db.service';
import { companies, people, personApps, plans, subscriptions } from '../db/schema';

/** Seats while a trial runs (PLAN.md §21). */
export const TRIAL_SEAT_LIMIT = 50;
export const TRIAL_DAYS = 14;
export const READ_ONLY_STATES = ['read_only', 'suspended'] as const;
export const READ_ONLY_MESSAGE = "Your company's subscription is read-only. The owner can renew it in Billing.";
export const SUSPENDED_MESSAGE = "Your company's subscription is suspended. Ask the owner to renew it in Billing.";

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;

/** 402 Payment Required with a message for the person (plan, seat and read-only limits). */
export const paymentRequired = (message: string) => new HttpException({ statusCode: 402, message }, 402);

export const isReadOnly = (state: string | null | undefined) => !!state && (READ_ONLY_STATES as readonly string[]).includes(state);

/** The company's subscription; a company without one (made before §21, or directly in tests) counts as Complimentary. */
export async function subscriptionOf(dbs: DbService, companyId: string): Promise<{ sub: SubscriptionRow; plan: PlanRow }> {
  const [row] = await dbs.db.select({ sub: subscriptions, plan: plans }).from(subscriptions).innerJoin(plans, eq(plans.code, subscriptions.plan)).where(eq(subscriptions.companyId, companyId)).limit(1);
  if (row) return row;
  const now = new Date();
  return {
    sub: { companyId, plan: 'complimentary', interval: 'month', state: 'active', stateSince: now, seats: 0, nextPeriodSeats: null, trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, clockOffsetDays: 0, gateway: null, gatewaySubscriptionId: null, createdAt: now, updatedAt: now },
    plan: { code: 'complimentary', name: 'Complimentary', description: '', apps: ['tasks', 'assets'], priceMonthly: 0, priceYearly: 0, minSeats: 1, maxSeats: null, offered: false, sort: 9 },
  };
}

/** The person holds at least one of the company's apps (an app the plan no longer has does not count). */
const HOLDS_APP = sql<boolean>`exists (select 1 from ${personApps} join ${companies} on ${companies.id} = ${people.companyId}
  where ${personApps.personId} = ${people.id} and ${personApps.app} = any(${companies.enabledApps}))`;

/** Seats in use: active people with at least one app. */
export async function seatsUsed(dbs: DbService, companyId: string): Promise<number> {
  const [r] = await dbs.db
    .select({ n: sql<number>`count(*)::int` })
    .from(people)
    .where(and(eq(people.companyId, companyId), eq(people.status, 'active'), HOLDS_APP));
  return r?.n ?? 0;
}

/** How many seats the company may use now; null = no limit. */
export function seatLimit(sub: SubscriptionRow, plan: PlanRow): number | null {
  if (plan.code === 'complimentary') return null;
  if (sub.state === 'trialing') return TRIAL_SEAT_LIMIT;
  if (plan.priceMonthly === 0) return plan.maxSeats; // Free
  return sub.seats;
}

/** Plain words for "no free seat": what the plan allows and what to do (the owner, or "Manage billing", acts in Billing). */
export const seatsFullMessage = (limit: number, plan?: Pick<PlanRow, 'priceMonthly' | 'name'>, state?: string) =>
  state === 'trialing'
    ? `The free trial is for up to ${limit} users and all are in use. The owner can choose a plan in Billing to add more.`
    : plan && plan.priceMonthly === 0
      ? `The ${plan.name} plan is for up to ${limit} users and all ${limit} are in use. The owner can upgrade in Billing to add more people.`
      : `All ${limit} paid seats are in use. The owner can add seats in Billing.`;

/**
 * Before a person gets their first app: is there a free seat? (Someone who already has an app, or is switched off,
 * takes no new seat.) 402 when the company is full or read-only.
 */
export async function assertSeatFor(dbs: DbService, companyId: string, personId: string | null) {
  if (personId) {
    const [p] = await dbs.db
      .select({ status: people.status, hasApp: sql<boolean>`exists (select 1 from ${personApps} where ${personApps.personId} = ${people.id})` })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    if (p && (p.hasApp || p.status !== 'active')) return;
  }
  await assertNewSeat(dbs, companyId);
}

/** One more seat is about to be used (a new person with apps, or someone with apps switched back on). */
export async function assertNewSeat(dbs: DbService, companyId: string) {
  const { sub, plan } = await subscriptionOf(dbs, companyId);
  if (isReadOnly(sub.state)) throw paymentRequired(READ_ONLY_MESSAGE);
  const limit = seatLimit(sub, plan);
  if (limit === null) return;
  if ((await seatsUsed(dbs, companyId)) + 1 > limit) throw paymentRequired(seatsFullMessage(limit, plan, sub.state));
}

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Days in past_due before read-only, and in read-only before suspended (PLAN.md §21.1). */
export const PAST_DUE_DAYS = 7;
export const READ_ONLY_DAYS = 30;

/** The company's billing clock: real time plus the dev-tools offset. */
export function companyNow(sub: Pick<SubscriptionRow, 'clockOffsetDays'>): Date {
  return new Date(Date.now() + sub.clockOffsetDays * DAY_MS);
}

/** What `/auth/me` shows for banners. daysLeft: of the trial, before read-only, of a cancelled period, before suspension. */
export async function billingSummary(dbs: DbService, companyId: string) {
  const { sub } = await subscriptionOf(dbs, companyId);
  const now = companyNow(sub);
  let until: Date | null = null;
  if (sub.state === 'trialing') until = sub.trialEndsAt;
  else if (sub.state === 'past_due') until = new Date(sub.stateSince.getTime() + PAST_DUE_DAYS * DAY_MS);
  else if (sub.state === 'cancelled') until = sub.currentPeriodEnd;
  else if (sub.state === 'read_only') until = new Date(sub.stateSince.getTime() + READ_ONLY_DAYS * DAY_MS);
  return {
    plan: sub.plan,
    state: sub.state,
    trialEndsAt: sub.trialEndsAt,
    readOnly: isReadOnly(sub.state),
    daysLeft: until ? Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS)) : null,
  };
}
