import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notFound, type Caller } from '../common/http';
import { CompanySetupService } from '../company/setup.service';
import { CompanyService } from '../company/company.service';
import { DbService, type Executor } from '../db/db.service';
import {
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
  subscriptions,
} from '../db/schema';
import { FakeGateway, type GatewayEvent, FAKE_SIGNATURE_HEADER, type PaymentGateway, signFake } from './gateway';
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
  private readonly gateways = new Map<string, PaymentGateway>([['fake', new FakeGateway()]]);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dbs: DbService,
    private readonly setup: CompanySetupService,
    private readonly company: CompanyService,
  ) {}

  onModuleInit() {
    const seconds = Number(process.env.BILLING_TICK_SECONDS ?? 300);
    if (process.env.NODE_ENV === 'test' || process.env.FF_CLI === 'true' || !seconds) return;
    this.timer = setInterval(() => void this.runAll().catch((err) => this.log.error(`Billing clock: ${(err as Error).message}`)), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The gateway new checkouts use (the fake one until Razorpay is wired). */
  private gateway(): PaymentGateway {
    return this.gateways.get('fake')!;
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
    };
  }

  // ─── checkout ───────────────────────────────────────────────────────────

  /** POST billing/checkout: prices the purchase (with a credit for unused paid time), opens a gateway checkout. */
  async checkout(caller: Caller, input: z.infer<typeof checkoutSchema>) {
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
    const tax = gst(lines, (await this.buyer(caller.companyId)).state);
    const [session] = await this.dbs.db
      .insert(checkoutSessions)
      .values({
        companyId: caller.companyId,
        gateway: this.gateway().name,
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
    const { checkoutUrl } = await this.gateway().createCheckout({ sessionId: session.id, companyId: caller.companyId, amount: tax.total, description: lines[0].description });
    return { sessionId: session.id, checkoutUrl };
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
    return { id: s.id, plan: s.plan, planName: plan.name, interval: s.interval, seats: s.seats, lines: s.lines, subtotal: s.subtotal, cgst: s.cgst, sgst: s.sgst, igst: s.igst, total: s.total, companyName: c?.name ?? '', status, gateway: s.gateway };
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

  /** POST billing/webhook/:gateway: signature checked, stored once by event id, applied. */
  async handleWebhook(gatewayName: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    const gateway = this.gateways.get(gatewayName);
    if (!gateway) throw new NotFoundException('Unknown payment gateway');
    if (!rawBody?.length) throw new BadRequestException('Empty event');
    const event = gateway.verifyWebhook(headers, rawBody);
    const after: After = [];
    const result = await this.dbs.tx(async (tx) => {
      const [stored] = await tx
        .insert(billingEvents)
        .values({ gateway: gatewayName, eventId: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (!stored) return { ok: true, duplicate: true };
      await this.applyEvent(tx, gatewayName, event, after);
      return { ok: true, duplicate: false };
    });
    for (const fn of after) await fn();
    return result;
  }

  private async applyEvent(tx: Executor, gatewayName: string, event: GatewayEvent, after: After) {
    if (!/^[0-9a-f-]{36}$/i.test(event.sessionId)) return;
    const [s] = await tx.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, event.sessionId), eq(checkoutSessions.gateway, gatewayName))).for('update').limit(1);
    if (!s || s.status !== 'open') return; // already settled (or unknown): nothing changes
    if (event.type === 'checkout.cancelled') {
      await tx.update(checkoutSessions).set({ status: 'cancelled', completedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
      return;
    }
    if (event.type === 'payment.failed') {
      // A first purchase that fails changes nothing but the checkout.
      await tx.update(checkoutSessions).set({ status: 'failed', completedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
      await tx.insert(payments).values({ companyId: s.companyId, checkoutSessionId: s.id, gateway: gatewayName, gatewayPaymentId: event.paymentId ?? null, amount: s.total, status: 'failed', reason: event.reason ?? null });
      return;
    }
    if (typeof event.amount === 'number' && event.amount !== s.total) {
      this.log.error(`Checkout ${s.id}: paid ${event.amount}, expected ${s.total}; not applied`);
      return;
    }
    // Paid: the plan starts now, for one period.
    await tx.update(checkoutSessions).set({ status: 'paid', completedAt: new Date() }).where(eq(checkoutSessions.id, s.id));
    const sub = await this.lockSub(tx, s.companyId);
    const now = companyNow(sub);
    const end = addInterval(now, s.interval);
    await tx
      .update(subscriptions)
      .set({ plan: s.plan, interval: s.interval, state: 'active', stateSince: now, seats: s.seats, nextPeriodSeats: null, currentPeriodStart: now, currentPeriodEnd: end, cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(subscriptions.companyId, s.companyId));
    const pending = await this.pendingSeatLines(s.companyId, tx);
    const invoice = await this.createInvoice(tx, s.companyId, { issuedAt: now, periodStart: now, periodEnd: end, lines: s.lines, checkoutSessionId: s.id, total: s.total });
    if (pending.ids.length) await tx.update(seatChanges).set({ invoiceId: invoice.id }).where(inArray(seatChanges.id, pending.ids));
    await tx.insert(payments).values({ companyId: s.companyId, invoiceId: invoice.id, checkoutSessionId: s.id, gateway: gatewayName, gatewayPaymentId: event.paymentId ?? null, amount: s.total, status: 'captured' });
    const plan = await this.plan(s.plan);
    after.push(() => this.applyEntitlements(s.companyId, plan));
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

  /** More seats now (the extra is charged pro rata on the next invoice); fewer from the next period, never below use. */
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
    const rows = await this.dbs.db.select().from(invoices).where(eq(invoices.companyId, companyId)).orderBy(desc(invoices.issuedAt), desc(invoices.seq)).limit(200);
    return rows.map((r) => ({ id: r.id, number: r.number, issuedAt: iso(r.issuedAt), periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd), subtotal: r.subtotal, tax: r.cgst + r.sgst + r.igst, total: r.total, status: r.status }));
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
    const free = await this.plan('free');
    const used = await seatsUsed(this.dbs, companyId);
    if (free.maxSeats !== null && used > free.maxSeats) return false;
    const held = await tx
      .selectDistinct({ app: personApps.app })
      .from(personApps)
      .innerJoin(people, eq(people.id, personApps.personId))
      .innerJoin(companies, eq(companies.id, people.companyId))
      .where(and(eq(people.companyId, companyId), eq(people.status, 'active'), sql`${personApps.app} = any(${companies.enabledApps})`));
    return held.every((h) => free.apps.includes(h.app));
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
      if (sub.state === 'past_due') {
        const until = new Date(sub.stateSince.getTime() + PAST_DUE_DAYS * DAY_MS);
        if (opts.forceRenewal) return this.renew(tx, sub, plan, now, opts.renewalOutcome ?? 'success', true);
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
      if (sub.state === 'active' && isPaid(plan) && sub.currentPeriodEnd && (sub.currentPeriodEnd <= now || opts.forceRenewal)) {
        return this.renew(tx, sub, plan, now, opts.renewalOutcome ?? 'success', !!opts.forceRenewal);
      }
      return false;
    });
  }

  /**
   * Charges the next period through the gateway. Paid: a new period (seats lowered for it if asked) and an invoice with
   * the pro-rata seat lines. Failed: past_due from the end of the paid period.
   */
  private async renew(tx: Executor, sub: SubscriptionRow, plan: PlanRow, now: Date, outcome: 'success' | 'failure', forced: boolean): Promise<boolean> {
    const companyId = sub.companyId;
    // A forced renewal ("simulate the next renewal") charges now; a past_due one starts a new period now.
    const start = forced || sub.state === 'past_due' ? now : (sub.currentPeriodEnd ?? now);
    const end = addInterval(start, sub.interval);
    const seats = sub.nextPeriodSeats ?? sub.seats;
    const pending = await this.pendingSeatLines(companyId, tx);
    const lines = [...this.planLines(plan, sub.interval, seats, start, end), ...pending.lines];
    const tax = gst(lines, (await this.buyer(companyId)).state);
    const charge = await this.gateway().chargeRenewal({ companyId, amount: tax.total, outcome });
    const set = (values: Partial<SubscriptionRow>) => tx.update(subscriptions).set({ ...values, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
    if (!charge.ok) {
      await tx.insert(payments).values({ companyId, gateway: this.gateway().name, gatewayPaymentId: charge.paymentId, amount: tax.total, status: 'failed', reason: charge.reason ?? null });
      if (sub.state === 'past_due') return false; // still past due; the 7 days keep running
      await set({ state: 'past_due', stateSince: forced ? now : (sub.currentPeriodEnd ?? now) });
      return true;
    }
    const invoice = await this.createInvoice(tx, companyId, { issuedAt: start, periodStart: start, periodEnd: end, lines });
    if (pending.ids.length) await tx.update(seatChanges).set({ invoiceId: invoice.id }).where(inArray(seatChanges.id, pending.ids));
    await tx.insert(payments).values({ companyId, invoiceId: invoice.id, gateway: this.gateway().name, gatewayPaymentId: charge.paymentId, amount: tax.total, status: 'captured' });
    await set({ state: 'active', stateSince: sub.state === 'active' ? sub.stateSince : now, seats, nextPeriodSeats: null, currentPeriodStart: start, currentPeriodEnd: end });
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

  // ─── owner console (FreeFounders staff) ─────────────────────────────────

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

  /** Only FreeFounders staff accounts open the owner console. */
  async assertStaff(caller: Caller) {
    const [row] = await this.dbs.db.execute<{ is_staff: boolean }>(sql`select a.is_staff from platform.people p join platform.accounts a on a.id = p.account_id where p.id = ${caller.personId}`).then((r) => r.rows);
    if (!row?.is_staff) throw new ForbiddenException('FreeFounders staff only');
  }
}
