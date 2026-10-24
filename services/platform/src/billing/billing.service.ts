import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EXPORT_MAX } from '../common/export';
import { notFound, type Caller } from '../common/http';
import type { SheetCell } from '../common/sheet';
import { CompanySetupService } from '../company/setup.service';
import { CompanyService } from '../company/company.service';
import { DbService, type Executor } from '../db/db.service';
import {
  accounts,
  type AppKey,
  APPS,
  billingEvents,
  billingProfiles,
  checkoutSessions,
  companies,
  type GstParty,
  invoiceCounters,
  invoiceLines,
  type InvoiceLineInput,
  invoices,
  payments,
  people,
  personApps,
  plans,
  seatChanges,
  staffAudit,
  subscriptions,
} from '../db/schema';
import {
  FAKE_SIGNATURE_HEADER,
  FakeGateway,
  type CheckoutCreated,
  type GatewayConfig,
  gatewayConfig,
  type GatewayEvent,
  PAYMENTS_OFF_MESSAGE,
  type PaymentGateway,
  type RenewalResult,
  signFake,
} from './gateway';
import { CashfreeError, CashfreeGateway, orderIdOf, type OrderCheck } from './cashfree.gateway';
import { financialYear, gst, GSTIN_RE, invoiceNumber, SAC_SAAS, seller, stateName } from './gst';
import {
  companyNow,
  DAY_MS,
  isReadOnly,
  PAST_DUE_DAYS,
  type PlanRow,
  READ_ONLY_DAYS,
  seatLimit,
  seatsUsed,
  type SubscriptionRow,
  subscriptionOf,
  TRIAL_DAYS,
} from './seats';
import { platformLog } from '../console/log-sink';

/** Postgres advisory lock: one Platform process runs the billing clock at a time (like the events poller). */
export const BILLING_LOCK = 4_646_002;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;
const MAX_SEATS = 10_000;

/** Dev tools (advance the billing clock, simulate renewals): BILLING_DEV_TOOLS=1, never in production. */
export function billingDevTools(): boolean {
  return process.env.BILLING_DEV_TOOLS === '1' && process.env.NODE_ENV !== 'production';
}

export const profileSchema = z.object({
  legalName: z.string().trim().min(2, 'Enter the legal name').max(200),
  gstin: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : v),
    z.string().regex(GSTIN_RE, 'Enter a valid 15-character GSTIN').nullable().optional(),
  ),
  state: z.string().trim().refine((s) => !!stateName(s), 'Choose a state'),
  address: z.string().trim().max(500).nullable().optional(),
  email: z.preprocess((v) => (typeof v === 'string' && !v.trim() ? null : v), z.string().trim().toLowerCase().email('Enter a valid email').max(200).nullable().optional()),
});
export const checkoutSchema = z.object({
  plan: z.string().trim().min(1).max(40),
  interval: z.enum(['month', 'year']),
  seats: z.number().int().min(1).max(MAX_SEATS),
});
export const seatsSchema = z.object({ seats: z.number().int().min(1).max(MAX_SEATS) });
export const outcomeSchema = z.object({ outcome: z.enum(['success', 'failure', 'cancel']) });
export const renewSchema = z.object({ outcome: z.enum(['success', 'failure']).default('success') });
export const advanceSchema = z.object({ days: z.number().int().min(1).max(400), renewalOutcome: z.enum(['success', 'failure']).default('success') });
/** The payment page asks the server to look a Cashfree order up (back from Cashfree, or while waiting). */
export const cashfreeCheckSchema = z.object({ sessionId: z.string().uuid() });
/** Open Cashfree orders that ended without a word from Cashfree are looked up by the billing clock for this long. */
const CASHFREE_SWEEP_MS = 3 * DAY_MS;
/** Gateways where the owner pays each period on the Billing page (no saved card charged by us). */
const paysEachPeriod = (gateway: string | null | undefined) => !!gateway && gateway !== 'fake';

const addInterval = (d: Date, interval: string) => {
  const out = new Date(d);
  if (interval === 'year') out.setUTCFullYear(out.getUTCFullYear() + 1);
  else out.setUTCMonth(out.getUTCMonth() + 1);
  return out;
};
const priceOf = (plan: PlanRow, interval: string) => (interval === 'year' ? plan.priceYearly : plan.priceMonthly);
const isPaid = (plan: PlanRow) => plan.priceMonthly > 0;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const intervalLabel = (i: string) => (i === 'year' ? 'yearly' : 'monthly');

type After = Array<() => Promise<unknown>>;

/**
 * Plans, subscriptions and invoices (PLAN.md §21). The state machine:
 * trialing → active → past_due (7 days) → read_only (30 days) → suspended; cancelled → at the period end Free if it fits,
 * else read_only; a trial ends on Free if it fits (≤ the Free plan's seats, only Tasks used), else read_only.
 * Every date is on the company's billing clock (real time + the dev-tools offset).
 */
@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Billing');
  private readonly fake = new FakeGateway();
  /** Gateways whose webhooks are accepted: FakePay always (it checks its own secret), Cashfree when its keys are set. */
  private readonly gateways = new Map<string, PaymentGateway>([['fake', this.fake]]);
  /** PAYMENT_GATEWAY and its keys, checked once at start-up (gateway.ts). */
  readonly config: GatewayConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dbs: DbService,
    private readonly setup: CompanySetupService,
    private readonly company: CompanyService,
  ) {
    this.config = gatewayConfig();
    if (this.config.cashfree) {
      this.gateways.set('cashfree', new CashfreeGateway(this.config.cashfree));
      // Only the start of the App ID; the Secret Key is never logged.
      this.log.log(`Payments: Cashfree (${this.config.cashfree.env}, API ${this.config.cashfree.apiVersion}, App ID ${this.config.cashfree.appId.slice(0, 6)}…)`);
    } else if (this.config.problem) {
      this.log.error(`Payments are OFF (checkout answers 503): ${this.config.problem}. Everything else keeps working.`);
    }
  }

  onModuleInit() {
    const seconds = Number(process.env.BILLING_TICK_SECONDS ?? 300);
    if (process.env.NODE_ENV === 'test' || process.env.FF_CLI === 'true' || !seconds) return;
    this.timer = setInterval(() => void this.runAll().catch((err) => this.log.error(`Billing clock: ${(err as Error).message}`)), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The gateway new checkouts use (PAYMENT_GATEWAY); 503 when payments are not set up. */
  private gateway(): PaymentGateway {
    const g = this.config.name ? this.gateways.get(this.config.name) : undefined;
    if (!g) throw new ServiceUnavailableException(PAYMENTS_OFF_MESSAGE);
    return g;
  }

  /** The Cashfree gateway; 503 when its keys are not set on this server. */
  private cashfree(): CashfreeGateway {
    const g = this.gateways.get('cashfree');
    if (!(g instanceof CashfreeGateway)) throw new ServiceUnavailableException(PAYMENTS_OFF_MESSAGE);
    return g;
  }

  /** A Cashfree error in words for the owner (never the request or the keys). */
  private gatewayFailed(err: unknown, action: string): never {
    if (err instanceof CashfreeError) {
      this.log.warn(`Cashfree ${action}: ${err.status} ${err.message}`);
      platformLog({ level: 'warn', event: 'billing.gateway_error', message: `Cashfree ${action}: ${err.status} ${err.code ?? ''} ${err.message}`.trim() });
      if (err.status === 0 || err.status >= 500) throw new BadGatewayException('Cashfree could not be reached. Please try again in a minute.');
      if (err.status === 401 || err.status === 403) throw new ServiceUnavailableException(PAYMENTS_OFF_MESSAGE);
      throw new BadRequestException(`Cashfree: ${err.message}`);
    }
    throw err;
  }

  private async plan(code: string): Promise<PlanRow> {
    const [p] = await this.dbs.db.select().from(plans).where(eq(plans.code, code)).limit(1);
    if (!p) throw new BadRequestException({ message: 'Unknown plan', errors: { plan: 'Unknown plan' } });
    return p;
  }

  // ─── new companies ──────────────────────────────────────────────────────

  /** A new company (sign-up, New company): 14 days of Suite, no card; its GST details start from the sign-up form. */
  async startTrial(tx: Executor, companyId: string, buyer: { legalName: string; state: string | null; email: string | null }) {
    const now = new Date();
    await tx.insert(subscriptions).values({ companyId, plan: 'suite', interval: 'month', state: 'trialing', stateSince: now, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS) });
    await tx.insert(billingProfiles).values({ companyId, legalName: buyer.legalName, state: stateName(buyer.state) ?? seller().state, email: buyer.email }).onConflictDoNothing();
  }

  // ─── the Billing page ───────────────────────────────────────────────────

  async plans() {
    const rows = await this.dbs.db.select().from(plans).where(eq(plans.offered, true)).orderBy(asc(plans.sort));
    return rows.map((p) => ({ code: p.code, name: p.name, description: p.description, apps: p.apps, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, minSeats: p.minSeats, maxSeats: p.maxSeats }));
  }

  private async profile(companyId: string) {
    const [p] = await this.dbs.db.select().from(billingProfiles).where(eq(billingProfiles.companyId, companyId)).limit(1);
    return p ? { legalName: p.legalName, gstin: p.gstin, state: p.state, address: p.address, email: p.email } : null;
  }

  private async buyer(companyId: string): Promise<GstParty> {
    const p = await this.profile(companyId);
    if (p) return { name: p.legalName, gstin: p.gstin, state: p.state, address: p.address, email: p.email };
    const [c] = await this.dbs.db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return { name: c?.name ?? 'Customer', gstin: null, state: seller().state, address: null, email: null };
  }

  async setProfile(companyId: string, input: z.infer<typeof profileSchema>) {
    const values = { legalName: input.legalName, gstin: input.gstin ?? null, state: stateName(input.state)!, address: input.address || null, email: input.email ?? null, updatedAt: new Date() };
    await this.dbs.db.insert(billingProfiles).values({ companyId, ...values }).onConflictDoUpdate({ target: billingProfiles.companyId, set: values });
    return this.profile(companyId);
  }

  /** The plan line(s) of one period. */
  private planLines(plan: PlanRow, interval: string, seats: number, start: Date | null, end: Date | null): InvoiceLineInput[] {
    const unit = priceOf(plan, interval);
    return [{ description: `${plan.name} plan, ${intervalLabel(interval)} (${seats} seat${seats === 1 ? '' : 's'})`, sac: SAC_SAAS, quantity: seats, unitPrice: unit, amount: unit * seats, periodStart: iso(start), periodEnd: iso(end) }];
  }

  /** Seats added mid-period, not invoiced yet. */
  private async pendingSeatLines(companyId: string, db: Executor = this.dbs.db): Promise<{ ids: string[]; lines: InvoiceLineInput[] }> {
    const rows = await db.select().from(seatChanges).where(and(eq(seatChanges.companyId, companyId), isNull(seatChanges.invoiceId))).orderBy(asc(seatChanges.createdAt));
    return {
      ids: rows.map((r) => r.id),
      lines: rows.map((r) => ({
        description: `${r.seatsTo - r.seatsFrom} seat${r.seatsTo - r.seatsFrom === 1 ? '' : 's'} added (${r.seatsFrom} → ${r.seatsTo}), pro rata`,
        sac: SAC_SAAS,
        quantity: r.seatsTo - r.seatsFrom,
        unitPrice: Math.round(r.amount / Math.max(1, r.seatsTo - r.seatsFrom)),
        amount: r.amount,
        periodStart: iso(r.effectiveAt),
        periodEnd: iso(r.periodEnd),
      })),
    };
  }

  /** GET billing */
  async view(companyId: string) {
    const { sub, plan } = await subscriptionOf(this.dbs, companyId);
    const now = companyNow(sub);
    const used = await seatsUsed(this.dbs, companyId);
    let nextCharge: null | { date: string | null; lines: InvoiceLineInput[]; subtotal: number; tax: number; total: number } = null;
    if (isPaid(plan) && ['active', 'past_due'].includes(sub.state) && !sub.cancelAtPeriodEnd && sub.currentPeriodEnd) {
      const seats = sub.nextPeriodSeats ?? sub.seats;
      const start = sub.currentPeriodEnd;
      const lines = [...this.planLines(plan, sub.interval, seats, start, addInterval(start, sub.interval)), ...(await this.pendingSeatLines(companyId)).lines];
      const tax = gst(lines, (await this.buyer(companyId)).state);
      nextCharge = { date: iso(start), lines, subtotal: tax.subtotal, tax: tax.cgst + tax.sgst + tax.igst, total: tax.total };
    }
    return {
      plan: plan.code,
      planName: plan.name,
      apps: plan.apps,
      interval: sub.interval,
      state: sub.state,
      readOnly: isReadOnly(sub.state),
      trialEndsAt: iso(sub.trialEndsAt),
      currentPeriodStart: iso(sub.currentPeriodStart),
      currentPeriodEnd: iso(sub.currentPeriodEnd),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      seats: { used, paid: isPaid(plan) ? sub.seats : 0, limit: seatLimit(sub, plan), nextPeriod: sub.nextPeriodSeats },
      nextCharge,
      profile: await this.profile(companyId),
      devTools: billingDevTools(),
      now: now.toISOString(),
      /** Who took the last payment ('cashfree' or 'fake'). */
      gateway: sub.gateway === 'cashfree' ? 'cashfree' : 'fake',
      /** The gateway new payments use; null = payments are not set up on this server (checkout answers 503). */
      checkoutGateway: this.config.name,
      canResume: true,
      /** Cashfree: nothing is charged by itself; the owner pays each period here (past due until then). */
      paysEachPeriod: paysEachPeriod(sub.gateway),
    };
  }

  // ─── checkout ───────────────────────────────────────────────────────────

  /** POST billing/checkout: prices the purchase (with a credit for unused paid time), opens a gateway checkout. */
  async checkout(caller: Caller, input: z.infer<typeof checkoutSchema>) {
    const gateway = this.gateway(); // 503 first: nothing is priced or stored while payments are off
    const plan = await this.plan(input.plan);
    if (!plan.offered || !isPaid(plan)) throw new BadRequestException({ message: 'Choose a paid plan', errors: { plan: 'Choose a paid plan' } });
    const used = await seatsUsed(this.dbs, caller.companyId);
    const min = Math.max(plan.minSeats, used);
    if (input.seats < min) {
      const why = used > plan.minSeats ? `${used} people use the apps now` : `the ${plan.name} plan starts at ${plan.minSeats} seats`;
      throw new BadRequestException({ message: `Choose at least ${min} seats: ${why}.`, errors: { seats: `At least ${min}` } });
    }
    if (plan.maxSeats && input.seats > plan.maxSeats) throw new BadRequestException({ message: `At most ${plan.maxSeats} seats`, errors: { seats: `At most ${plan.maxSeats}` } });
    const { sub, plan: current } = await subscriptionOf(this.dbs, caller.companyId);
    const now = companyNow(sub);
    const end = addInterval(now, input.interval);
    const lines = this.planLines(plan, input.interval, input.seats, now, end);
    // An upgrade starts now: what is left of the paid period comes off the price.
    if (isPaid(current) && ['active', 'cancelled'].includes(sub.state) && sub.currentPeriodStart && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
      const len = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime();
      const credit = Math.round((sub.seats * priceOf(current, sub.interval) * (sub.currentPeriodEnd.getTime() - now.getTime())) / Math.max(1, len));
      if (credit > 0) lines.push({ description: `Unused time on the ${current.name} plan (credit)`, sac: SAC_SAAS, quantity: 1, unitPrice: -credit, amount: -credit, periodStart: iso(now), periodEnd: iso(sub.currentPeriodEnd) });
    }
    lines.push(...(await this.pendingSeatLines(caller.companyId)).lines);
    const buyerState = (await this.buyer(caller.companyId)).state;
    const tax = gst(lines, buyerState);
    // Cashfree's smallest order is ₹1.
    if (gateway.name === 'cashfree' && tax.total < 100) {
      throw new BadRequestException('Nothing to pay now: the unused time on your current plan covers this change. Choose it near the end of the period, or contact Kaampilot support.');
    }
    const [session] = await this.dbs.db
      .insert(checkoutSessions)
      .values({
        companyId: caller.companyId,
        gateway: gateway.name,
        plan: plan.code,
        interval: input.interval,
        seats: input.seats,
        lines,
        subtotal: tax.subtotal,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total: tax.total,
        createdBy: caller.personId,
        expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
      })
      .returning();
    let created: CheckoutCreated;
    try {
      created = await gateway.createCheckout({
        sessionId: session.id,
        companyId: caller.companyId,
        amount: tax.total,
        description: `Kaampilot ${lines[0].description}, ${input.interval === 'year' ? 'one year' : 'one month'} incl. GST`,
        expiresAt: session.expiresAt,
        customer: await this.customer(caller.companyId, caller.personId),
      });
    } catch (err) {
      await this.dbs.db.update(checkoutSessions).set({ status: 'failed', completedAt: new Date() }).where(eq(checkoutSessions.id, session.id));
      this.gatewayFailed(err, 'create order');
    }
    if (created.ref || created.data) await this.dbs.db.update(checkoutSessions).set({ gatewayRef: created.ref ?? null, gatewayData: created.data ?? null }).where(eq(checkoutSessions.id, session.id));
    if (gateway.name !== 'fake') platformLog({ level: 'info', event: 'billing.checkout', message: `${gateway.name} order ${created.ref ?? session.id} for ${tax.total} paise`, companyId: caller.companyId });
    return { sessionId: session.id, checkoutUrl: created.checkoutUrl, gateway: gateway.name };
  }

  /** Who pays: the person who started the checkout (their account), with the billing e-mail when there is one. */
  private async customer(companyId: string, personId: string | null | undefined) {
    const profile = await this.profile(companyId);
    const [who] = personId
      ? await this.dbs.db
          .select({ accountId: accounts.id, name: people.fullName, email: people.email, accountEmail: accounts.email, mobile: accounts.mobile })
          .from(people)
          .leftJoin(accounts, eq(accounts.id, people.accountId))
          .where(eq(people.id, personId))
          .limit(1)
      : [];
    return {
      id: who?.accountId ?? companyId,
      name: who?.name ?? profile?.legalName ?? null,
      email: profile?.email ?? who?.accountEmail ?? who?.email ?? null,
      phone: who?.mobile ?? null,
    };
  }

  private async session(companyId: string, id: string) {
    const [s] = await this.dbs.db.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, id), eq(checkoutSessions.companyId, companyId))).limit(1);
    if (!s) throw notFound('Checkout');
    return s;
  }

  /** GET billing/checkout/:id (the FakePay page). */
  async getCheckout(companyId: string, id: string) {
    const s = await this.session(companyId, id);
    const plan = await this.plan(s.plan);
    const [c] = await this.dbs.db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const status = s.status === 'open' && s.expiresAt < new Date() ? 'expired' : s.status;
    const out = { id: s.id, plan: s.plan, planName: plan.name, interval: s.interval, seats: s.seats, lines: s.lines, subtotal: s.subtotal, cgst: s.cgst, sgst: s.sgst, igst: s.igst, total: s.total, companyName: c?.name ?? '', status, gateway: s.gateway };
    if (s.gateway !== 'cashfree' || status !== 'open') return out;
    const paymentSessionId = typeof s.gatewayData?.paymentSessionId === 'string' ? s.gatewayData.paymentSessionId : null;
    const mode = s.gatewayData?.mode === 'production' ? 'production' : 'sandbox';
    // payment_session_id goes only to the person who started this checkout's company (billing.manage); never logged.
    return { ...out, cashfree: paymentSessionId ? { paymentSessionId, mode, orderId: s.gatewayRef } : null };
  }

  /**
   * Looks a Cashfree order up and applies what Cashfree says (same event ids as the webhook: applied once).
   * Answers what happened to the latest attempt: paid, failed (the person may try again), pending, expired.
   */
  private async refreshCashfree(s: typeof checkoutSessions.$inferSelect): Promise<OrderCheck['status']> {
    if (s.gateway !== 'cashfree') throw new BadRequestException('This checkout is not a Cashfree checkout');
    if (s.status === 'paid') return 'paid';
    // Also for a checkout closed here: a payment Cashfree took late still counts (applyEvent).
    let r: OrderCheck;
    try {
      r = await this.cashfree().checkOrder(s.gatewayRef ?? orderIdOf(s.id));
    } catch (err) {
      this.gatewayFailed(err, 'get order');
    }
    if (r.status !== 'pending') {
      const result = await this.storeAndApply('cashfree', r.event);
      platformLog({ level: 'info', event: 'billing.payment', message: `cashfree ${r.event.type} (order look-up)${result.duplicate ? ' (already known)' : ''}`, companyId: s.companyId });
    }
    return r.status;
  }

  /** POST billing/cashfree/check: the payment page, back from Cashfree (return URL) or waiting for the result. */
  async cashfreeCheck(companyId: string, sessionId: string) {
    const s = await this.session(companyId, sessionId);
    const attempt = await this.refreshCashfree(s);
    return { ...(await this.getCheckout(companyId, s.id)), attempt };
  }

  /**
   * Billing clock: open Cashfree orders whose checkout has ended (nobody came back to the return URL and no webhook
   * arrived, e.g. a closed browser tab) are looked up once more: paid → applied; otherwise the checkout closes.
   */
  async sweepCashfree(): Promise<number> {
    if (!this.gateways.has('cashfree')) return 0;
    const now = Date.now();
    const rows = await this.dbs.db
      .select()
      .from(checkoutSessions)
      .where(and(eq(checkoutSessions.gateway, 'cashfree'), eq(checkoutSessions.status, 'open'), sql`${checkoutSessions.expiresAt} < ${new Date(now - 5 * 60_000)}`, sql`${checkoutSessions.expiresAt} > ${new Date(now - CASHFREE_SWEEP_MS)}`))
      .limit(200);
    let settled = 0;
    for (const s of rows) {
      try {
        const r = await this.refreshCashfree(s);
        if (r === 'paid') settled++;
        else if (r !== 'expired') {
          // Cashfree closes the order at its expiry time; a dropped or failed last attempt ends the checkout here too.
          await this.dbs.db.update(checkoutSessions).set({ status: r === 'failed' ? 'failed' : 'cancelled', completedAt: new Date() }).where(and(eq(checkoutSessions.id, s.id), eq(checkoutSessions.status, 'open')));
        }
      } catch (err) {
        this.log.warn(`Cashfree look-up for checkout ${s.id}: ${(err as Error).message}`);
      }
    }
    return settled;
  }

  /**
   * POST billing/fake/:id/complete: FakePay's Pay / Fail / Cancel. The result reaches the Platform as a webhook signed
   * with FAKE_GATEWAY_SECRET and checked by the same handler a real gateway's webhook goes through.
   */
  async fakeComplete(companyId: string, id: string, outcome: 'success' | 'failure' | 'cancel') {
    const s = await this.session(companyId, id);
    if (s.gateway !== 'fake') throw new BadRequestException('This checkout is not a test checkout');
    const event: GatewayEvent = {
      id: `evt_${randomBytes(12).toString('hex')}`,
      type: outcome === 'success' ? 'payment.captured' : outcome === 'failure' ? 'payment.failed' : 'checkout.cancelled',
      sessionId: s.id,
      paymentId: `fakepay_${randomBytes(8).toString('hex')}`,
      amount: s.total,
      ...(outcome === 'failure' ? { reason: 'Payment declined (test)' } : {}),
    };
    const raw = Buffer.from(JSON.stringify(event));
    await this.handleWebhook('fake', { [FAKE_SIGNATURE_HEADER]: signFake(raw) }, raw);
    return { ...(await this.getCheckout(companyId, id)), redirectUrl: '/billing' };
  }

  /**
   * POST billing/webhooks/:gateway: signature checked, stored once by event id, applied. Events we do not use (a test
   * event from the dashboard, charges…) are stored and answered 200 so the gateway does not retry them.
   */
  async handleWebhook(gatewayName: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    const gateway = this.gateways.get(gatewayName);
    if (!gateway) {
      // Cashfree retries later: say "not ready" rather than "unknown" while its keys are missing on this server.
      if (gatewayName === 'cashfree') throw new ServiceUnavailableException(PAYMENTS_OFF_MESSAGE);
      throw new NotFoundException('Unknown payment gateway');
    }
    if (!rawBody?.length) throw new BadRequestException('Empty event');
    let event: GatewayEvent;
    try {
      event = gateway.verifyWebhook(headers, rawBody);
    } catch (err) {
      platformLog({ level: 'warn', event: 'billing.webhook_rejected', message: `${gatewayName} webhook refused: ${(err as Error).message}` });
      throw err;
    }
    if (event.check && event.sessionId && gateway instanceof CashfreeGateway) {
      // A payment event we could not read in full: Cashfree's own order status decides (before storing, so a failed
      // look-up answers 502 and Cashfree sends the webhook again).
      const [s] = await this.dbs.db.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, event.sessionId), eq(checkoutSessions.gateway, 'cashfree'))).limit(1);
      if (s) await this.refreshCashfree(s);
    }
    const result = await this.storeAndApply(gatewayName, event);
    // Production log (PLAN.md §21.9): every webhook that arrived, never its payload.
    const companyId = event.sessionId ? ((await this.dbs.db.select({ c: checkoutSessions.companyId }).from(checkoutSessions).where(eq(checkoutSessions.id, event.sessionId)).limit(1))[0]?.c ?? null) : null;
    platformLog({ level: 'info', event: 'billing.webhook', message: `${gatewayName} ${event.type}${event.source && event.source !== event.type ? ` (${event.source})` : ''}${result.duplicate ? ' (duplicate, ignored)' : ''}`, companyId });
    return result;
  }

  /** Stores the event once (billing_events, unique per gateway + event id) and applies it in the same transaction. */
  private async storeAndApply(gatewayName: string, event: GatewayEvent) {
    const after: After = [];
    const result = await this.dbs.tx(async (tx) => {
      const [stored] = await tx
        .insert(billingEvents)
        .values({ gateway: gatewayName, eventId: event.id, type: event.source && event.source !== event.type ? `${event.type} (${event.source})` : event.type, payload: event as unknown as Record<string, unknown> })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (!stored) return { ok: true, duplicate: true };
      await this.applyEvent(tx, gatewayName, event, after);
      return { ok: true, duplicate: false };
    });
    for (const fn of after) await fn().catch((err) => this.log.error(`After billing event ${event.id}: ${(err as Error).message}`));
    return result;
  }

  /** The checkout an event is about (our session id), locked. */
  private async eventSession(tx: Executor, gatewayName: string, event: GatewayEvent) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.sessionId)) return null;
    const [s] = await tx.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, event.sessionId), eq(checkoutSessions.gateway, gatewayName))).for('update').limit(1);
    return s ?? null;
  }

  private async applyEvent(tx: Executor, gatewayName: string, event: GatewayEvent, after: After) {
    if (event.type === 'ignored') return;
    const s = await this.eventSession(tx, gatewayName, event);
    if (!s || s.status === 'paid') return; // unknown, or already paid: nothing changes
    // Money Cashfree took counts even when the checkout was closed here meanwhile (expired, or the clock gave up on it).
    const lateCapture = event.type === 'payment.captured' && gatewayName === 'cashfree';
    if (s.status !== 'open' && !lateCapture) return;
    if (event.type === 'checkout.cancelled') {
      await tx.update(checkoutSessions).set({ status: 'cancelled', completedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
      return;
    }
    if (event.type === 'payment.failed') {
      // A first purchase that fails changes nothing but the checkout. Cashfree lets the person try again on the same
      // order until it expires, so a Cashfree checkout stays open (the billing clock closes it after its expiry).
      if (gatewayName !== 'cashfree') await tx.update(checkoutSessions).set({ status: 'failed', completedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
      await tx.insert(payments).values({ companyId: s.companyId, checkoutSessionId: s.id, gateway: gatewayName, gatewayPaymentId: event.paymentId ?? null, amount: s.total, status: 'failed', reason: event.reason ?? null });
      platformLog({ level: 'info', event: 'billing.payment', message: `${gatewayName} payment failed: ${event.reason ?? 'no reason given'}`, companyId: s.companyId });
      return;
    }
    if (typeof event.amount === 'number' && event.amount !== s.total) {
      this.log.error(`Checkout ${s.id}: paid ${event.amount}, expected ${s.total}; not applied`);
      platformLog({ level: 'error', event: 'billing.amount_mismatch', message: `${gatewayName} checkout ${s.id}: paid ${event.amount} paise, expected ${s.total}; not applied (check the gateway dashboard)`, companyId: s.companyId });
      return;
    }
    // Paid: the plan starts now, for one period.
    await tx.update(checkoutSessions).set({ status: 'paid', completedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
    const sub = await this.lockSub(tx, s.companyId);
    const now = companyNow(sub);
    const end = addInterval(now, s.interval);
    platformLog({ level: 'info', event: 'billing.payment', message: `${gatewayName} payment captured: ${s.total} paise`, companyId: s.companyId });
    await tx
      .update(subscriptions)
      .set({
        plan: s.plan,
        interval: s.interval,
        state: 'active',
        stateSince: now,
        seats: s.seats,
        nextPeriodSeats: null,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        gateway: gatewayName,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.companyId, s.companyId));
    const pending = await this.pendingSeatLines(s.companyId, tx);
    const invoice = await this.createInvoice(tx, s.companyId, { issuedAt: now, periodStart: now, periodEnd: end, lines: s.lines, checkoutSessionId: s.id, total: s.total });
    if (pending.ids.length) await tx.update(seatChanges).set({ invoiceId: invoice.id }).where(inArray(seatChanges.id, pending.ids));
    await tx.insert(payments).values({ companyId: s.companyId, invoiceId: invoice.id, checkoutSessionId: s.id, gateway: gatewayName, gatewayPaymentId: event.paymentId ?? null, amount: s.total, status: 'captured' });
    const plan = await this.plan(s.plan);
    after.push(() => this.applyEntitlements(s.companyId, plan));
  }

  /**
   * A paid renewal: the next period (seats lowered for it if asked), an invoice with the pro-rata seat lines, the
   * payment. Used by the billing clock for FakePay renewals (Cashfree periods are paid as new checkouts).
   */
  private async recordRenewal(
    tx: Executor,
    sub: SubscriptionRow,
    plan: PlanRow,
    now: Date,
    r: { gatewayName: string; paymentId: string; amount?: number; periodStart?: string; periodEnd?: string; forced?: boolean },
  ) {
    const companyId = sub.companyId;
    // A forced renewal ("simulate the next renewal") charges now; a past_due one starts a new period now.
    const start = r.periodStart ? new Date(r.periodStart) : r.forced || sub.state !== 'active' ? now : (sub.currentPeriodEnd ?? now);
    const end = r.periodEnd ? new Date(r.periodEnd) : addInterval(start, sub.interval);
    const seats = sub.nextPeriodSeats ?? sub.seats;
    const pending = await this.pendingSeatLines(companyId, tx);
    const lines = [...this.planLines(plan, sub.interval, seats, start, end), ...pending.lines];
    const invoice = await this.createInvoice(tx, companyId, { issuedAt: start, periodStart: start, periodEnd: end, lines });
    if (typeof r.amount === 'number' && r.amount !== invoice.total) {
      this.log.warn(`Company ${companyId}: ${r.gatewayName} charged ${r.amount} paise, invoice ${invoice.number} says ${invoice.total} (rounding)`);
    }
    if (pending.ids.length) await tx.update(seatChanges).set({ invoiceId: invoice.id }).where(inArray(seatChanges.id, pending.ids));
    await tx.insert(payments).values({ companyId, invoiceId: invoice.id, gateway: r.gatewayName, gatewayPaymentId: r.paymentId, amount: r.amount ?? invoice.total, status: 'captured' });
    await tx
      .update(subscriptions)
      .set({ state: 'active', stateSince: sub.state === 'active' ? sub.stateSince : now, seats, nextPeriodSeats: null, currentPeriodStart: start, currentPeriodEnd: end, cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptions.companyId, companyId));
  }

  /** The subscription row, locked for this transaction (created as Complimentary if the company had none). */
  private async lockSub(tx: Executor, companyId: string): Promise<SubscriptionRow> {
    await tx.insert(subscriptions).values({ companyId, plan: 'complimentary', state: 'active' }).onConflictDoNothing();
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).for('update').limit(1);
    return sub;
  }

  /** A GST tax invoice, numbered atomically in its financial year (FF/2026-27/000001). */
  private async createInvoice(
    tx: Executor,
    companyId: string,
    inv: { issuedAt: Date; periodStart: Date | null; periodEnd: Date | null; lines: InvoiceLineInput[]; checkoutSessionId?: string; total?: number },
  ) {
    const buyer = await this.buyer(companyId);
    const tax = gst(inv.lines, buyer.state);
    const fy = financialYear(inv.issuedAt);
    const [counter] = await tx
      .insert(invoiceCounters)
      .values({ financialYear: fy, last: 1 })
      .onConflictDoUpdate({ target: invoiceCounters.financialYear, set: { last: sql`${invoiceCounters.last} + 1` } })
      .returning({ last: invoiceCounters.last });
    const [row] = await tx
      .insert(invoices)
      .values({
        companyId,
        number: invoiceNumber(fy, counter.last),
        financialYear: fy,
        seq: counter.last,
        issuedAt: inv.issuedAt,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        seller: seller(),
        buyer,
        placeOfSupply: tax.placeOfSupply,
        subtotal: tax.subtotal,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total: tax.total,
        status: 'paid',
        checkoutSessionId: inv.checkoutSessionId ?? null,
      })
      .returning();
    if (inv.lines.length) {
      await tx.insert(invoiceLines).values(
        inv.lines.map((l, i) => ({
          invoiceId: row.id,
          position: i + 1,
          description: l.description,
          sac: l.sac,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: l.amount,
          periodStart: l.periodStart ? new Date(l.periodStart) : null,
          periodEnd: l.periodEnd ? new Date(l.periodEnd) : null,
        })),
      );
    }
    return row;
  }

  // ─── seats, cancel, resume ──────────────────────────────────────────────

  /**
   * More seats now (the extra is charged pro rata on the next invoice: the next renewal, or with Cashfree the next
   * checkout the owner pays); fewer from the next period, never below use.
   */
  async changeSeats(companyId: string, seats: number) {
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const plan = await this.plan(sub.plan);
      if (!isPaid(plan) || !['active', 'cancelled', 'past_due'].includes(sub.state) || !sub.currentPeriodStart || !sub.currentPeriodEnd) {
        throw new BadRequestException('Seats can be changed on a paid plan. Choose a plan first.');
      }
      const used = await seatsUsed(this.dbs, companyId);
      const min = Math.max(plan.minSeats, used);
      if (seats < min) throw new BadRequestException({ message: `Keep at least ${min} seats (${used} in use; the plan starts at ${plan.minSeats}).`, errors: { seats: `At least ${min}` } });
      const now = companyNow(sub);
      if (seats > sub.seats) {
        const len = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime();
        const left = Math.max(0, sub.currentPeriodEnd.getTime() - now.getTime());
        const amount = Math.round(((seats - sub.seats) * priceOf(plan, sub.interval) * left) / Math.max(1, len));
        await tx.insert(seatChanges).values({ companyId, seatsFrom: sub.seats, seatsTo: seats, effectiveAt: now, periodEnd: sub.currentPeriodEnd, amount });
        await tx.update(subscriptions).set({ seats, nextPeriodSeats: null, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
      } else {
        await tx.update(subscriptions).set({ nextPeriodSeats: seats === sub.seats ? null : seats, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
      }
    });
    return this.view(companyId);
  }

  /** Cancel at the end of the paid period (nothing is charged by itself after it). */
  async cancel(companyId: string) {
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const plan = await this.plan(sub.plan);
      if (!isPaid(plan) || sub.state !== 'active') throw new BadRequestException('Only an active paid plan can be cancelled');
      await tx.update(subscriptions).set({ state: 'cancelled', stateSince: companyNow(sub), cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
    });
    return this.view(companyId);
  }

  async resume(companyId: string) {
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      if (sub.state !== 'cancelled') throw new BadRequestException('The plan is not cancelled');
      await tx.update(subscriptions).set({ state: 'active', stateSince: companyNow(sub), cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
    });
    return this.view(companyId);
  }

  // ─── invoices ───────────────────────────────────────────────────────────

  async invoices(companyId: string) {
    const rows = await this.invoiceRows(companyId, 200);
    return rows.map((r) => ({ id: r.id, number: r.number, issuedAt: iso(r.issuedAt), periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd), subtotal: r.subtotal, tax: r.cgst + r.sgst + r.igst, total: r.total, status: r.status }));
  }

  private invoiceRows(companyId: string, limit: number) {
    return this.dbs.db.select().from(invoices).where(eq(invoices.companyId, companyId)).orderBy(desc(invoices.issuedAt), desc(invoices.seq)).limit(limit);
  }

  /** The company's invoices as spreadsheet rows (PLAN.md §19.31), rupees as numbers. */
  async invoicesSheet(companyId: string) {
    const rows = await this.invoiceRows(companyId, EXPORT_MAX);
    const rs = (paise: number) => Math.round(paise) / 100;
    return {
      header: ['Invoice no.', 'Date', 'Period from', 'Period to', 'Place of supply', 'Buyer', 'Buyer GSTIN', 'Taxable value (Rs.)', 'CGST (Rs.)', 'SGST (Rs.)', 'IGST (Rs.)', 'Total (Rs.)', 'Status'],
      rows: rows.map((r) => [r.number, r.issuedAt, r.periodStart, r.periodEnd, r.placeOfSupply, r.buyer.name, r.buyer.gstin, rs(r.subtotal), rs(r.cgst), rs(r.sgst), rs(r.igst), rs(r.total), r.status] as SheetCell[]),
    };
  }

  async invoice(companyId: string, id: string) {
    const [r] = await this.dbs.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId))).limit(1);
    if (!r) throw notFound('Invoice');
    const lines = await this.dbs.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position));
    return {
      id: r.id,
      number: r.number,
      financialYear: r.financialYear,
      issuedAt: iso(r.issuedAt),
      periodStart: iso(r.periodStart),
      periodEnd: iso(r.periodEnd),
      seller: r.seller,
      buyer: r.buyer,
      placeOfSupply: r.placeOfSupply,
      reverseCharge: false,
      currency: 'INR',
      lines: lines.map((l) => ({ description: l.description, sac: l.sac, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, periodStart: iso(l.periodStart), periodEnd: iso(l.periodEnd) })),
      subtotal: r.subtotal,
      cgstRate: r.cgst || (!r.igst && r.placeOfSupply === r.seller.state) ? 9 : 0,
      cgst: r.cgst,
      sgstRate: r.sgst || (!r.igst && r.placeOfSupply === r.seller.state) ? 9 : 0,
      sgst: r.sgst,
      igstRate: r.placeOfSupply !== r.seller.state ? 18 : 0,
      igst: r.igst,
      total: r.total,
      status: r.status,
    };
  }

  // ─── the billing clock (state machine) ─────────────────────────────────

  /** Moves to Free when the company fits it: at most the Free plan's seats, and nobody uses an app Free lacks. */
  private async fitsFree(tx: Executor, companyId: string): Promise<boolean> {
    return (await this.freeFit(tx, companyId)).ok;
  }

  /**
   * Does the company fit the Free plan, and if not, what to switch off (the same rule as trial end / cancel → Free):
   * at most the Free plan's seats in use, and no active person holding an app Free lacks (Assets).
   */
  private async freeFit(tx: Executor, companyId: string): Promise<{ ok: boolean; over: number; extraApps: string[]; message: string | null }> {
    const free = await this.plan('free');
    const used = await seatsUsed(this.dbs, companyId);
    const over = free.maxSeats !== null ? Math.max(0, used - free.maxSeats) : 0;
    const held = await tx
      .select({ app: personApps.app, holders: sql<number>`count(distinct ${people.id})::int` })
      .from(personApps)
      .innerJoin(people, eq(people.id, personApps.personId))
      .innerJoin(companies, eq(companies.id, people.companyId))
      .where(and(eq(people.companyId, companyId), eq(people.status, 'active'), sql`${personApps.app} = any(${companies.enabledApps})`))
      .groupBy(personApps.app);
    const extra = held.filter((h) => !free.apps.includes(h.app));
    const extraApps = extra.map((h) => h.app);
    if (!over && !extraApps.length) return { ok: true, over, extraApps, message: null };
    const label = (a: string) => `${a.charAt(0).toUpperCase()}${a.slice(1)}`;
    const appNames = extraApps.map((a) => `the ${label(a)} app`).join(' and ');
    const what = [over ? `${over} ${over === 1 ? 'person' : 'people'}` : '', appNames].filter(Boolean).join(' and ');
    // The company cannot switch an app off by itself: the app is taken away from the people who have it.
    const how = extra.map((h) => ` (Admin → People: take ${label(h.app)} away from the ${h.holders === 1 ? 'person who has' : `${h.holders} people who have`} it)`).join('');
    return { ok: false, over, extraApps, message: `The Free plan is for up to ${free.maxSeats ?? 3} users using Attendance and Tasks. Switch off ${what} first${how}.` };
  }

  /**
   * POST billing/free: the owner chooses the Free plan (no payment). Only when the company fits it (freeFit).
   * Trialing, past due or read-only → Free now (read-only ends); an active paid plan → cancelled at the end of the paid
   * period, then Free (the billing clock, as for Cancel); already cancelled → nothing more to do. Free switches the Assets app off for the company (applyEntitlements).
   */
  async switchToFree(companyId: string) {
    const after: After = [];
    let when: 'now' | 'period_end' = 'now';
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const plan = await this.plan(sub.plan);
      if (plan.code === 'free') throw new BadRequestException('This company is already on the Free plan.');
      if (plan.code === 'complimentary') throw new BadRequestException('This company has a complimentary plan. Contact Kaampilot support to change it.');
      if (sub.state === 'suspended') throw new BadRequestException('This company is suspended. Contact Kaampilot support.');
      const fit = await this.freeFit(tx, companyId);
      if (!fit.ok) throw new BadRequestException({ message: fit.message, errors: { plan: fit.message } });
      const now = companyNow(sub);
      if (sub.state === 'cancelled') {
        when = 'period_end';
        return;
      }
      if (isPaid(plan) && sub.state === 'active') {
        await tx.update(subscriptions).set({ state: 'cancelled', stateSince: now, cancelAtPeriodEnd: true, nextPeriodSeats: null, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
        when = 'period_end';
        return;
      }
      if (!['trialing', 'past_due', 'read_only'].includes(sub.state)) throw new BadRequestException('The Free plan cannot be chosen now.');
      await tx
        .update(subscriptions)
        .set({ plan: 'free', state: 'active', stateSince: now, seats: 0, nextPeriodSeats: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, gateway: null, updatedAt: new Date() })
        .where(eq(subscriptions.companyId, companyId));
      const free = await this.plan('free');
      after.push(() => this.applyEntitlements(companyId, free));
    });
    for (const fn of after) await fn();
    return { ...(await this.view(companyId)), freeFrom: when };
  }

  /** One step of the state machine for one company; true when something changed (call again until false). */
  private async step(companyId: string, opts: { renewalOutcome?: 'success' | 'failure'; forceRenewal?: boolean }, after: After): Promise<boolean> {
    return this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const plan = await this.plan(sub.plan);
      const now = companyNow(sub);
      const set = (values: Partial<SubscriptionRow>) => tx.update(subscriptions).set({ ...values, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
      const toFreeOrReadOnly = async (at: Date) => {
        if (await this.fitsFree(tx, companyId)) {
          await set({ plan: 'free', state: 'active', stateSince: at, seats: 0, nextPeriodSeats: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
          const free = await this.plan('free');
          after.push(() => this.applyEntitlements(companyId, free));
        } else {
          await set({ state: 'read_only', stateSince: at, cancelAtPeriodEnd: false });
        }
      };

      if (plan.code === 'complimentary') return false;
      if (sub.state === 'trialing') {
        if (!sub.trialEndsAt || sub.trialEndsAt > now) return false;
        await toFreeOrReadOnly(sub.trialEndsAt);
        return true;
      }
      if (sub.state === 'cancelled') {
        if (!sub.currentPeriodEnd || sub.currentPeriodEnd > now) return false;
        await toFreeOrReadOnly(sub.currentPeriodEnd);
        return true;
      }
      // Cashfree: nothing charges by itself; at the period end the plan waits (past due) for the owner to pay it on the
      // Billing page (a new checkout; paying starts a fresh period). FakePay renews on its own.
      const manual = paysEachPeriod(sub.gateway);
      if (sub.state === 'past_due') {
        const until = new Date(sub.stateSince.getTime() + PAST_DUE_DAYS * DAY_MS);
        if (!manual && opts.forceRenewal) return this.renew(tx, sub, plan, now, opts.renewalOutcome ?? 'success', true);
        if (until > now) return false;
        await set({ state: 'read_only', stateSince: until });
        return true;
      }
      if (sub.state === 'read_only') {
        const until = new Date(sub.stateSince.getTime() + READ_ONLY_DAYS * DAY_MS);
        if (until > now) return false;
        await set({ state: 'suspended', stateSince: until });
        return true;
      }
      if (sub.state === 'active' && isPaid(plan) && sub.currentPeriodEnd && manual && sub.currentPeriodEnd <= now) {
        await set({ state: 'past_due', stateSince: sub.currentPeriodEnd });
        return true;
      }
      if (sub.state === 'active' && isPaid(plan) && sub.currentPeriodEnd && !manual && (sub.currentPeriodEnd <= now || opts.forceRenewal)) {
        return this.renew(tx, sub, plan, now, opts.renewalOutcome ?? 'success', !!opts.forceRenewal);
      }
      return false;
    });
  }

  /**
   * Charges the next period through FakePay. Paid: a new period (seats lowered for it if asked) and an invoice with
   * the pro-rata seat lines. Failed: past_due from the end of the paid period.
   */
  private async renew(tx: Executor, sub: SubscriptionRow, plan: PlanRow, now: Date, outcome: 'success' | 'failure', forced: boolean): Promise<boolean> {
    const companyId = sub.companyId;
    const fake = this.fake;
    const start = forced || sub.state === 'past_due' ? now : (sub.currentPeriodEnd ?? now);
    const seats = sub.nextPeriodSeats ?? sub.seats;
    const lines = [...this.planLines(plan, sub.interval, seats, start, addInterval(start, sub.interval)), ...(await this.pendingSeatLines(companyId, tx)).lines];
    const tax = gst(lines, (await this.buyer(companyId)).state);
    const charge = await fake.chargeRenewal({ companyId, amount: tax.total, outcome });
    if (!charge.ok) return this.renewalFailed(tx, sub, now, forced, fake.name, charge, tax.total);
    await this.recordRenewal(tx, sub, plan, now, { gatewayName: fake.name, paymentId: charge.paymentId, forced });
    return true;
  }

  /** A failed renewal: past_due from the end of the paid period (or now when forced); already past_due stays so. */
  private async renewalFailed(tx: Executor, sub: SubscriptionRow, now: Date, forced: boolean, gatewayName: string, charge: RenewalResult, amount: number) {
    await tx.insert(payments).values({ companyId: sub.companyId, gateway: gatewayName, gatewayPaymentId: charge.paymentId || null, amount, status: 'failed', reason: charge.reason ?? null });
    if (sub.state === 'past_due') return false; // still past due; the 7 days keep running
    await tx
      .update(subscriptions)
      .set({ state: 'past_due', stateSince: forced ? now : (sub.currentPeriodEnd ?? now), updatedAt: new Date() })
      .where(eq(subscriptions.companyId, sub.companyId));
    return true;
  }

  /** Runs the state machine for one company until nothing changes, then applies plan changes in the apps. */
  async tick(companyId: string, opts: { renewalOutcome?: 'success' | 'failure'; forceRenewal?: boolean } = {}) {
    const after: After = [];
    let changed = false;
    for (let i = 0; i < 500; i++) {
      const moved = await this.step(companyId, i === 0 ? opts : { renewalOutcome: opts.renewalOutcome }, after);
      if (!moved) break;
      changed = true;
    }
    for (const fn of after) await fn();
    return changed;
  }

  /** Every company with a billing date to check; one Platform process at a time (advisory lock). */
  async runAll(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const client = await this.dbs.pool.connect().catch((err) => {
      this.running = false;
      throw err;
    });
    let changed = 0;
    try {
      const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [BILLING_LOCK]);
      if (!rows[0]?.ok) return 0;
      try {
        const subs = await this.dbs.db.select({ id: subscriptions.companyId }).from(subscriptions).where(and(ne(subscriptions.plan, 'complimentary'), ne(subscriptions.state, 'suspended')));
        for (const s of subs) {
          try {
            if (await this.tick(s.id)) changed++;
          } catch (err) {
            this.log.warn(`Billing for company ${s.id}: ${(err as Error).message}`);
          }
        }
        changed += await this.sweepCashfree().catch((err) => {
          this.log.warn(`Cashfree order look-ups: ${(err as Error).message}`);
          return 0;
        });
      } finally {
        await client.query('select pg_advisory_unlock($1)', [BILLING_LOCK]).catch(() => undefined);
      }
    } finally {
      client.release();
      this.running = false;
    }
    return changed;
  }

  // ─── dev tools ──────────────────────────────────────────────────────────

  private assertDevTools() {
    if (!billingDevTools()) throw new NotFoundException();
  }

  /** Moves this company's billing clock forward and runs the state machine. */
  async devAdvance(companyId: string, days: number, renewalOutcome: 'success' | 'failure') {
    this.assertDevTools();
    await this.dbs.tx(async (tx) => {
      await this.lockSub(tx, companyId);
      await tx.update(subscriptions).set({ clockOffsetDays: sql`${subscriptions.clockOffsetDays} + ${days}` }).where(eq(subscriptions.companyId, companyId));
    });
    await this.tick(companyId, { renewalOutcome });
    return this.view(companyId);
  }

  /** Runs the next renewal now, succeeding or failing. */
  async devRenew(companyId: string, outcome: 'success' | 'failure') {
    this.assertDevTools();
    const { sub, plan } = await subscriptionOf(this.dbs, companyId);
    if (!isPaid(plan) || !['active', 'past_due'].includes(sub.state)) throw new BadRequestException('Nothing to renew: buy a paid plan first');
    if (paysEachPeriod(sub.gateway)) throw new BadRequestException('This plan is paid on the Billing page each period: renewals cannot be simulated');
    await this.tick(companyId, { renewalOutcome: outcome, forceRenewal: true });
    return this.view(companyId);
  }

  // ─── what a plan unlocks ────────────────────────────────────────────────

  /**
   * The plan's apps become the company's apps (module switches stay as they were). A new app is set up in that app and
   * opened for the people whose roles reach it; an app the plan lacks is switched off for the company. Nothing is
   * deleted: switching it back on brings everything back. Complimentary keeps whatever the company has.
   */
  async applyEntitlements(companyId: string, plan: PlanRow) {
    if (plan.code === 'complimentary') return;
    const want = plan.apps.filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!c) return;
    const have = c.apps.filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
    const added = want.filter((a) => !have.includes(a));
    const removed = have.filter((a) => !want.includes(a));
    if (!added.length && !removed.length) return;
    await this.dbs.db.update(companies).set({ enabledApps: want, updatedAt: new Date() }).where(eq(companies.id, companyId));
    this.log.log(`Company ${companyId} on ${plan.code}: apps ${want.join(', ') || 'none'}`);
    try {
      if (added.length) await this.setup.addApps(companyId, added);
      else await this.company.push(companyId);
    } catch (err) {
      this.log.error(`Plan change for company ${companyId}: ${(err as Error).message} (npm run company -- sync repairs it)`);
    }
  }

  // ─── owner console (Kaampilot staff) ─────────────────────────────────

  private mrrOf(sub: { state: string; seats: number; interval: string }, plan: { priceMonthly: number; priceYearly: number }) {
    if (!['active', 'past_due', 'cancelled'].includes(sub.state) || plan.priceMonthly === 0) return 0;
    return sub.interval === 'year' ? Math.round((sub.seats * plan.priceYearly) / 12) : sub.seats * plan.priceMonthly;
  }

  async consoleCompanies() {
    const rows = await this.dbs.db
      .select({
        id: companies.id,
        name: companies.name,
        code: companies.code,
        status: companies.status,
        apps: companies.enabledApps,
        createdAt: companies.createdAt,
        plan: sql<string>`coalesce(${subscriptions.plan}, 'complimentary')`,
        state: sql<string>`coalesce(${subscriptions.state}, 'active')`,
        interval: sql<string>`coalesce(${subscriptions.interval}, 'month')`,
        seats: sql<number>`coalesce(${subscriptions.seats}, 0)`,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        clockOffsetDays: sql<number>`coalesce(${subscriptions.clockOffsetDays}, 0)`,
        used: sql<number>`(select count(*)::int from ${people} p where p.company_id = ${companies.id} and p.status = 'active'
          and exists (select 1 from ${personApps} pa where pa.person_id = p.id and pa.app = any(${companies.enabledApps})))`,
        owner: sql<string | null>`(select coalesce(p.email, p.full_name) from ${people} p where p.company_id = ${companies.id} and p.platform_role = 'owner' order by p.created_at limit 1)`,
      })
      .from(companies)
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
      .orderBy(desc(companies.createdAt))
      .limit(1000);
    const planRows = await this.dbs.db.select().from(plans);
    return rows.map((r) => {
      const plan = planRows.find((p) => p.code === r.plan)!;
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        owner: r.owner,
        apps: r.apps,
        plan: r.plan,
        planName: plan?.name ?? r.plan,
        state: r.state,
        interval: r.interval,
        seats: { used: r.used, paid: plan && plan.priceMonthly > 0 ? r.seats : 0 },
        mrr: plan ? this.mrrOf(r, plan) : 0,
        trialEndsAt: iso(r.trialEndsAt),
        currentPeriodEnd: iso(r.currentPeriodEnd),
        clockOffsetDays: r.clockOffsetDays,
        createdAt: iso(r.createdAt),
      };
    });
  }

  async consoleSummary() {
    const list = await this.consoleCompanies();
    const count = (pred: (c: (typeof list)[number]) => boolean) => list.filter(pred).length;
    return {
      companies: list.length,
      mrr: list.reduce((s, c) => s + c.mrr, 0),
      trialing: count((c) => c.state === 'trialing'),
      active: count((c) => c.state === 'active' && c.plan !== 'free' && c.plan !== 'complimentary'),
      free: count((c) => c.plan === 'free'),
      complimentary: count((c) => c.plan === 'complimentary'),
      pastDue: count((c) => c.state === 'past_due'),
      readOnly: count((c) => c.state === 'read_only'),
      suspended: count((c) => c.state === 'suspended'),
      cancelled: count((c) => c.state === 'cancelled'),
      seatsUsed: list.reduce((s, c) => s + c.seats.used, 0),
    };
  }

  private async assertCompany(id: string) {
    const [c] = await this.dbs.db.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).limit(1);
    if (!c) throw notFound('Company');
  }

  /** Extends (or restarts) a trial by N days from the later of now and its current end. */
  async consoleTrial(companyId: string, days: number) {
    await this.assertCompany(companyId);
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const now = companyNow(sub);
      const from = sub.state === 'trialing' && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
      await tx
        .update(subscriptions)
        .set({ plan: 'suite', state: 'trialing', stateSince: now, trialEndsAt: new Date(from.getTime() + days * DAY_MS), currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: new Date() })
        .where(eq(subscriptions.companyId, companyId));
    });
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /** Sets a plan without payment (a staff decision: complimentary, a deal paid by bank transfer…). */
  async consolePlan(companyId: string, planCode: string, seats: number) {
    await this.assertCompany(companyId);
    const plan = await this.plan(planCode);
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const now = companyNow(sub);
      const paid = isPaid(plan);
      // A staff-set plan is not charged by any gateway.
      await tx
        .update(subscriptions)
        .set({
          plan: plan.code,
          state: 'active',
          stateSince: now,
          seats: paid ? Math.max(seats, plan.minSeats) : 0,
          nextPeriodSeats: null,
          currentPeriodStart: paid ? now : null,
          currentPeriodEnd: paid ? addInterval(now, sub.interval) : null,
          cancelAtPeriodEnd: false,
          gateway: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.companyId, companyId));
    });
    await this.applyEntitlements(companyId, plan);
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /** Suspends a company (only owners can sign in, read-only) or reactivates it (a paid period that ended restarts now). */
  async consoleStatus(companyId: string, status: 'active' | 'suspended') {
    await this.assertCompany(companyId);
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const now = companyNow(sub);
      if (status === 'suspended') {
        await tx.update(subscriptions).set({ state: 'suspended', stateSince: now, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
        return;
      }
      const plan = await this.plan(sub.plan);
      const restart = isPaid(plan) && (!sub.currentPeriodEnd || sub.currentPeriodEnd <= now);
      const trialRunning = sub.plan === 'suite' && !sub.currentPeriodEnd && sub.trialEndsAt && sub.trialEndsAt > now;
      await tx
        .update(subscriptions)
        .set({
          state: trialRunning ? 'trialing' : 'active',
          stateSince: now,
          cancelAtPeriodEnd: false,
          ...(restart && !trialRunning ? { currentPeriodStart: now, currentPeriodEnd: addInterval(now, sub.interval), seats: Math.max(sub.seats, plan.minSeats) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.companyId, companyId));
    });
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /** Only Kaampilot staff accounts open the owner console; returns who it is (for the audit log). */
  async assertStaff(caller: Caller): Promise<StaffActor> {
    const [row] = await this.dbs.db
      .execute<{ id: string; email: string | null; mobile: string | null; is_staff: boolean }>(
        sql`select a.id, a.email, a.mobile, a.is_staff from platform.people p join platform.accounts a on a.id = p.account_id where p.id = ${caller.personId}`,
      )
      .then((r) => r.rows);
    if (!row?.is_staff) throw new ForbiddenException('Kaampilot staff only');
    return { accountId: row.id, email: row.email ?? row.mobile };
  }

  // ─── owner console audit log (PLAN.md §21.7) ────────────────────────────

  private async consoleSnapshot(companyId: string) {
    const [r] = await this.dbs.db
      .select({ code: companies.code, plan: subscriptions.plan, state: subscriptions.state, seats: subscriptions.seats, trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnd: subscriptions.currentPeriodEnd })
      .from(companies)
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!r) return null;
    return { code: r.code, state: { plan: r.plan ?? 'complimentary', state: r.state ?? 'active', seats: r.seats ?? 0, trialEndsAt: iso(r.trialEndsAt), currentPeriodEnd: iso(r.currentPeriodEnd) } };
  }

  /**
   * Runs one console change and writes one staff_audit row for it: who, from where, what was asked, the company's plan
   * before and after. A change that fails (404, bad plan) writes nothing.
   */
  async consoleAction<T>(staff: StaffActor, ip: string | undefined, action: ConsoleAction, companyId: string, input: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const before = await this.consoleSnapshot(companyId);
    const result = await run();
    const afterState = await this.consoleSnapshot(companyId);
    await this.dbs.db.insert(staffAudit).values({
      staffAccountId: staff.accountId,
      staffEmail: staff.email,
      action,
      companyId,
      companyCode: afterState?.code ?? before?.code ?? null,
      details: { input, before: before?.state ?? null, after: afterState?.state ?? null },
      ip: ip ?? null,
    });
    return result;
  }

  /** GET console/audit?export=xlsx|csv: every matching action (same filters), newest first. */
  async consoleAuditSheet(q: z.infer<typeof auditQuerySchema>) {
    const { rows } = await this.consoleAudit({ ...q, page: 1, pageSize: EXPORT_MAX });
    const val = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    return {
      header: ['When', 'Action', 'Company', 'Code', 'Staff', 'IP', 'Asked', 'Plan before', 'Plan after', 'State before', 'State after', 'Users after', 'Trial ends after'],
      rows: rows.map((r) => {
        const d = r.details as { input?: Record<string, unknown>; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null };
        return [
          r.at ? new Date(r.at) : null,
          r.action,
          r.companyName ?? '',
          r.companyCode ?? '',
          r.staffEmail ?? '',
          r.ip ?? '',
          d.input ? JSON.stringify(d.input) : '',
          val(d.before?.plan),
          val(d.after?.plan),
          val(d.before?.state),
          val(d.after?.state),
          val(d.after?.seats),
          d.after?.trialEndsAt ? new Date(String(d.after.trialEndsAt)) : null,
        ] as SheetCell[];
      }),
    };
  }

  /** GET console/audit: newest first, filtered by company (id or code) and action, paginated. */
  async consoleAudit(q: z.infer<typeof auditQuerySchema>) {
    const where = and(
      q.company ? (/^[0-9a-f-]{36}$/i.test(q.company) ? eq(staffAudit.companyId, q.company) : sql`upper(${staffAudit.companyCode}) = ${q.company.toUpperCase()}`) : undefined,
      q.action ? eq(staffAudit.action, q.action) : undefined,
    );
    const [{ total }] = await this.dbs.db.select({ total: sql<number>`count(*)::int` }).from(staffAudit).where(where);
    const rows = await this.dbs.db
      .select({ row: staffAudit, companyName: companies.name })
      .from(staffAudit)
      .leftJoin(companies, eq(companies.id, staffAudit.companyId))
      .where(where)
      .orderBy(desc(staffAudit.at), desc(staffAudit.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      actions: [...CONSOLE_ACTIONS, ...VIEW_ACTIONS],
      rows: rows.map(({ row: r, companyName }) => ({
        id: r.id,
        at: iso(r.at),
        staffAccountId: r.staffAccountId,
        staffEmail: r.staffEmail,
        action: r.action,
        companyId: r.companyId,
        companyCode: r.companyCode,
        companyName,
        details: r.details,
        ip: r.ip,
      })),
    };
  }
}

/** The staff account behind a console request. */
export interface StaffActor {
  accountId: string;
  email: string | null;
}
/** Every mutating owner-console action (each writes one staff_audit row). */
export const CONSOLE_ACTIONS = ['trial.extend', 'plan.set', 'company.suspend', 'company.reactivate'] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];
/** Read-only console views of a company's or person's data, also in the staff audit log (PLAN.md §21.9). */
export const VIEW_ACTIONS = ['view.company', 'view.user', 'view.users', 'view.billing', 'view.logs'] as const;
export const auditQuerySchema = z.object({
  company: z.string().trim().max(80).optional(),
  action: z.enum([...CONSOLE_ACTIONS, ...VIEW_ACTIONS]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
