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
  billingSettings,
  checkoutSessions,
  companies,
  departments,
  eventCursors,
  type GstParty,
  invoiceCounters,
  invoiceLines,
  type InvoiceLineInput,
  invoices,
  invites,
  modulePrices,
  payments,
  people,
  personApps,
  plans,
  roles,
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
import { financialYear, gst, GSTIN_RE, invoiceNumber, SAC_SAAS, seller, sellerProblem, stateName } from './gst';
import { resendConfig } from '../accounts/resend.sender';
import { MailError, sendResendMail } from '../common/resend-mail';
import { invoiceEmail, invoiceFileName, recipients } from './invoice-mail';
import { invoicePdf } from './invoice-pdf';
import {
  companyNow,
  DAY_MS,
  isReadOnly,
  PAST_DUE_DAYS,
  type PlanRow,
  READ_ONLY_DAYS,
  seatLimit,
  TRIAL_SEAT_LIMIT,
  seatsUsed,
  type SubscriptionRow,
  subscriptionOf,
} from './seats';
import { appsFor, cleanModules, MODULE_KEYS, normaliseSelection, planAreas, planModules, selectionName, tasksModuleAllowed, TASKS_MODULE_NEEDS, TRIAL_DEFAULTS, unitPrice } from './pricing';
import { GST_RATE } from './gst';
import { platformLog } from '../console/log-sink';

/** Postgres advisory lock: one Platform process runs the billing clock at a time (like the events poller). */
export const BILLING_LOCK = 4_646_002;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;
const MAX_SEATS = 10_000;
/** PLAN.md §24.4: a "Buy now" company not paid within this many days is cleaned up by the billing clock. */
export const PENDING_PAY_DAYS = 7;

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
  /** 'modules' (with `modules`) or 'complete' (PLAN.md §24.1); the older plan codes still work (pricing.ts). */
  plan: z.string().trim().min(1).max(40),
  modules: z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length).optional(),
  ai: z.boolean().default(false),
  interval: z.enum(['month', 'year']).default('month'),
  /** Users (paid seats). */
  seats: z.number().int().min(1).max(MAX_SEATS),
});
/** Trial length and users: the default for new companies (console). */
export const trialSettingsSchema = z.object({ days: z.number().int().min(1).max(365), maxUsers: z.number().int().min(1).max(MAX_SEATS) });
/** One company's trial (console): its length from the trial's start and/or its users. */
export const companyTrialSchema = z
  .object({ days: z.number().int().min(1).max(365).optional(), maxUsers: z.number().int().min(1).max(MAX_SEATS).optional() })
  .refine((v) => v.days !== undefined || v.maxUsers !== undefined, 'Give days or maxUsers');
export const seatsSchema = z.object({ seats: z.number().int().min(1).max(MAX_SEATS) });
/** PLAN.md §24.4: "Buy now" from the landing calculator / pricing page, carried through sign-up. */
export const buySchema = z.object({
  plan: z.enum(['modules', 'complete']),
  modules: z.array(z.enum(MODULE_KEYS)).max(MODULE_KEYS.length).optional(),
  ai: z.boolean().default(false),
  seats: z.number().int().min(1).max(MAX_SEATS),
});
export type BuyInput = z.infer<typeof buySchema>;
/** The billing email on the console (PLAN.md §24.5); null clears it. */
export const billingEmailSchema = z.object({
  email: z.preprocess((v) => (typeof v === 'string' && !v.trim() ? null : v), z.string().trim().toLowerCase().email('Enter a valid email').max(200).nullable()),
});
export const pendingExtendSchema = z.object({ days: z.number().int().min(1).max(60) });
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
const isPaid = (plan: PlanRow) => plan.priceMonthly > 0;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const intervalLabel = (i: string) => (i === 'year' ? 'yearly' : 'monthly');

type After = Array<() => Promise<unknown>>;
type ModulePriceRow = typeof modulePrices.$inferSelect;
/** What a subscription or a checkout has bought (PLAN.md §24.1). */
type Bought = { modules: readonly string[] | null; ai: boolean };

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
    // PLAN.md §24.5: invoices are still made, but not emailed with the test seller in production.
    const sellerIssue = sellerProblem();
    if (sellerIssue) this.log.warn(`${sellerIssue}: invoice emails are NOT sent (invoices are still created). Run infra/deploy/set-seller.sh.`);
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

  /** Module prices (PLAN.md §24.1), in their order. */
  async catalogue(db: Executor = this.dbs.db): Promise<ModulePriceRow[]> {
    return db.select().from(modulePrices).orderBy(asc(modulePrices.sort));
  }

  /** Per user for one period of this subscription or checkout. */
  private async unit(plan: PlanRow, bought: Bought, interval: string, db: Executor = this.dbs.db) {
    return unitPrice(plan, bought, await this.catalogue(db), interval);
  }

  // ─── trial defaults (console) ───────────────────────────────────────────

  /** The trial new companies get (staff change it in the console); 3 users for 10 days when nothing is stored. */
  async trialDefaults(db: Executor = this.dbs.db): Promise<{ days: number; maxUsers: number }> {
    const [row] = await db.select().from(billingSettings).where(eq(billingSettings.key, 'trial')).limit(1);
    const parsed = trialSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : { ...TRIAL_DEFAULTS };
  }

  async setTrialDefaults(input: z.infer<typeof trialSettingsSchema>) {
    await this.dbs.db
      .insert(billingSettings)
      .values({ key: 'trial', value: input })
      .onConflictDoUpdate({ target: billingSettings.key, set: { value: input, updatedAt: new Date() } });
    return this.trialDefaults();
  }

  /** GET /api/platform/public/pricing (PLAN.md §24 shared contract): rupees per user per month, no sign-in. */
  async publicPricing() {
    const [catalogue, trial, complete] = await Promise.all([this.catalogue(), this.trialDefaults(), this.plan('complete')]);
    const rs = (paise: number) => Math.round(paise) / 100;
    return {
      currency: 'INR' as const,
      perUserMonth: true,
      gstPercent: GST_RATE,
      modules: catalogue.map((m) => ({ key: m.key, name: m.name, price: rs(m.priceMonthly), aiPrice: rs(m.aiPriceMonthly) })),
      complete: { price: rs(complete.priceMonthly), aiPrice: rs(complete.aiPriceMonthly), includes: [...catalogue.map((m) => m.name), 'Visitors', 'Payroll'] },
      trial,
      calendlyUrl: process.env.CALENDLY_URL?.trim() || null,
      aiHelper: !!process.env.AI_API_KEY?.trim(),
    };
  }

  // ─── new companies ──────────────────────────────────────────────────────

  /**
   * A new company (sign-up, New company): a trial of Complete for the default days and users (PLAN.md §24.1; 3 users
   * for 10 days), no card; then read-only until a plan is paid. Its GST details start from the sign-up form.
   */
  async startTrial(tx: Executor, companyId: string, buyer: { legalName: string; state: string | null; email: string | null }) {
    const now = new Date();
    const trial = await this.trialDefaults(tx);
    await tx.insert(subscriptions).values({ companyId, plan: 'complete', interval: 'month', state: 'trialing', stateSince: now, trialEndsAt: new Date(now.getTime() + trial.days * DAY_MS), trialMaxUsers: trial.maxUsers });
    await tx.insert(billingProfiles).values({ companyId, legalName: buyer.legalName, state: stateName(buyer.state) ?? seller().state, email: buyer.email }).onConflictDoNothing();
  }

  /**
   * PLAN.md §24.4 "Buy now": a new company waiting for its first payment: the chosen plan, no trial, apps not set up
   * (`setup_pending`), cleaned up by the billing clock if not paid within PENDING_PAY_DAYS.
   */
  async startPending(tx: Executor, companyId: string, buyer: { legalName: string; state: string | null; email: string | null }, buy: BuyInput) {
    const sel = normaliseSelection(buy);
    const now = new Date();
    await tx.insert(subscriptions).values({
      companyId,
      plan: sel.plan,
      modules: sel.modules,
      ai: sel.ai,
      interval: 'month',
      state: 'pending_payment',
      stateSince: now,
      seats: buy.seats,
      setupPending: true,
      payBy: new Date(now.getTime() + PENDING_PAY_DAYS * DAY_MS),
    });
    await tx.insert(billingProfiles).values({ companyId, legalName: buyer.legalName, state: stateName(buyer.state) ?? seller().state, email: buyer.email }).onConflictDoNothing();
  }

  /** The apps a "Buy now" choice opens (the company row is written with them). */
  async appsForBuy(buy: BuyInput): Promise<AppKey[]> {
    const sel = normaliseSelection(buy);
    return appsFor(await this.plan(sel.plan), sel.modules);
  }

  /** Payments must be on before a "Buy now" company is made (503 otherwise; nothing is created). */
  assertPaymentsOn() {
    this.gateway();
  }

  /**
   * POST billing/start-trial (PLAN.md §24.4): a "Buy now" company that has not paid chooses the free trial instead
   * (only if it never had one). The apps are set up now.
   */
  async startTrialInstead(companyId: string) {
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      if (sub.state !== 'pending_payment') throw new BadRequestException('This company is not waiting for a payment.');
      if (sub.trialEndsAt) throw new BadRequestException('This company has already had its free trial. Choose a plan to continue.');
      const trial = await this.trialDefaults(tx);
      const now = new Date();
      await tx
        .update(subscriptions)
        .set({ plan: 'complete', modules: null, ai: false, interval: 'month', state: 'trialing', stateSince: now, seats: 0, trialEndsAt: new Date(now.getTime() + trial.days * DAY_MS), trialMaxUsers: trial.maxUsers, payBy: null, updatedAt: new Date() })
        .where(eq(subscriptions.companyId, companyId));
    });
    const setupIncomplete = !(await this.finishSetup(companyId));
    return { ...(await this.view(companyId)), setupIncomplete };
  }

  /**
   * A "Buy now" company that is paid (or chose the trial, or staff set a plan): its apps are set up now with the
   * plan's apps and module switches. True when done (or nothing to do); false = it failed and the billing clock tries
   * again (runAll), so a slow app never loses a payment.
   */
  async finishSetup(companyId: string): Promise<boolean> {
    const { sub, plan } = await subscriptionOf(this.dbs, companyId);
    if (!sub.setupPending || sub.state === 'pending_payment') return true;
    const want = appsFor(plan, sub.modules).filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
    const [c] = await this.dbs.db.update(companies).set({ enabledApps: want.length ? want : [...APPS], updatedAt: new Date() }).where(eq(companies.id, companyId)).returning();
    if (!c) return true;
    try {
      await this.setup.provisionNew(c, (line) => this.log.log(line.trim()));
    } catch (err) {
      this.log.error(`Setting up ${c.code} in the apps after payment: ${(err as Error).message} (the billing clock tries again)`);
      platformLog({ level: 'error', event: 'billing.setup_failed', message: `App set-up for ${c.code} failed; retried by the billing clock`, companyId });
      return false;
    }
    await this.dbs.db.update(subscriptions).set({ setupPending: false, updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
    await this.applyEntitlements(companyId, plan, sub.modules);
    this.log.log(`Company ${c.code}: apps set up (${c.enabledApps.join(', ')})`);
    return true;
  }

  // ─── the Billing page ───────────────────────────────────────────────────

  async plans() {
    const rows = await this.dbs.db.select().from(plans).where(eq(plans.offered, true)).orderBy(asc(plans.sort));
    return rows.map((p) => ({ code: p.code, name: p.name, description: p.description, apps: p.apps, kind: p.kind, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, aiPriceMonthly: p.aiPriceMonthly, minSeats: p.minSeats, maxSeats: p.maxSeats }));
  }

  /** GET billing/pricing: what the Billing screen prices with (paise per user per month; GST on top). */
  async pricing() {
    const [catalogue, complete, modules] = await Promise.all([this.catalogue(), this.plan('complete'), this.plan('modules')]);
    return {
      gstPercent: GST_RATE,
      modules: catalogue.map((m) => ({ key: m.key, name: m.name, description: m.description, price: m.priceMonthly, aiPrice: m.aiPriceMonthly })),
      complete: { name: complete.name, description: complete.description, price: complete.priceMonthly, aiPrice: complete.aiPriceMonthly },
      minSeats: Math.min(complete.minSeats, modules.minSeats),
    };
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

  /** The plan line(s) of one period: "Tasks + Attendance with AI plan, monthly (5 users)". */
  private async planLines(plan: PlanRow, bought: Bought, interval: string, seats: number, start: Date | null, end: Date | null, db: Executor = this.dbs.db): Promise<InvoiceLineInput[]> {
    const catalogue = await this.catalogue(db);
    const unit = unitPrice(plan, bought, catalogue, interval);
    const name = selectionName(plan, bought, catalogue);
    return [{ description: `${name} plan, ${intervalLabel(interval)} (${seats} user${seats === 1 ? '' : 's'})`, sac: SAC_SAAS, quantity: seats, unitPrice: unit, amount: unit * seats, periodStart: iso(start), periodEnd: iso(end) }];
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
      const lines = [...(await this.planLines(plan, sub, sub.interval, seats, start, addInterval(start, sub.interval))), ...(await this.pendingSeatLines(companyId)).lines];
      const tax = gst(lines, (await this.buyer(companyId)).state);
      nextCharge = { date: iso(start), lines, subtotal: tax.subtotal, tax: tax.cgst + tax.sgst + tax.igst, total: tax.total };
    }
    const catalogue = await this.catalogue();
    return {
      plan: plan.code,
      planName: selectionName(plan, sub, catalogue),
      apps: plan.kind === 'pick' ? appsFor(plan, sub.modules) : plan.apps,
      /** PLAN.md §24.1: the picked modules (plan 'modules'); null = every module. */
      modules: planModules(plan, sub.modules),
      ai: sub.ai,
      /** Per user per month now (paise); 0 on Free, trial and complimentary. */
      perUser: isPaid(plan) && sub.state !== 'trialing' ? unitPrice(plan, sub, catalogue, 'month') : 0,
      /** The older Free plan can still be chosen (companies from before §24.1). */
      freeAvailable: sub.freeFallback && plan.code !== 'free' && plan.code !== 'complimentary',
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
      /**
       * PLAN.md §24.4: a "Buy now" company waiting for its first payment: the chosen plan (above), when it is cleaned
       * up if not paid, and whether it may start the free trial instead (never had one).
       */
      pending:
        sub.state === 'pending_payment'
          ? { payBy: iso(sub.payBy), canStartTrial: !sub.trialEndsAt, seats: sub.seats, perUser: unitPrice(plan, sub, catalogue, 'month'), openCheckout: await this.openCheckoutOf(companyId) }
          : null,
      /** PLAN.md §24.5: why invoice emails are not sent on this server (null = they are). */
      invoiceEmail: this.invoiceEmailProblem(),
    };
  }

  /** The newest open, unexpired checkout of the company (the "Finish payment" screen continues it). */
  private async openCheckoutOf(companyId: string): Promise<{ sessionId: string; checkoutUrl: string } | null> {
    const [s] = await this.dbs.db
      .select({ id: checkoutSessions.id })
      .from(checkoutSessions)
      .where(and(eq(checkoutSessions.companyId, companyId), eq(checkoutSessions.status, 'open'), sql`${checkoutSessions.expiresAt} > now()`))
      .orderBy(desc(checkoutSessions.createdAt))
      .limit(1);
    return s ? { sessionId: s.id, checkoutUrl: `/billing/pay/${s.id}` } : null;
  }

  // ─── checkout ───────────────────────────────────────────────────────────

  /** POST billing/checkout: prices the purchase (with a credit for unused paid time), opens a gateway checkout. */
  async checkout(caller: Caller, input: z.infer<typeof checkoutSchema>) {
    const gateway = this.gateway(); // 503 first: nothing is priced or stored while payments are off
    const sel = normaliseSelection(input);
    const plan = await this.plan(sel.plan);
    if (!plan.offered || !isPaid(plan)) throw new BadRequestException({ message: 'Choose a paid plan', errors: { plan: 'Choose a paid plan' } });
    const bought: Bought = { modules: sel.modules, ai: sel.ai };
    const used = await seatsUsed(this.dbs, caller.companyId);
    const min = Math.max(plan.minSeats, used);
    if (input.seats < min) {
      const why = used > plan.minSeats ? `${used} people use the apps now` : `the ${plan.name} plan starts at ${plan.minSeats} users`;
      throw new BadRequestException({ message: `Choose at least ${min} users: ${why}.`, errors: { seats: `At least ${min}` } });
    }
    if (plan.maxSeats && input.seats > plan.maxSeats) throw new BadRequestException({ message: `At most ${plan.maxSeats} users`, errors: { seats: `At most ${plan.maxSeats}` } });
    const { sub, plan: current } = await subscriptionOf(this.dbs, caller.companyId);
    const now = companyNow(sub);
    const end = addInterval(now, input.interval);
    const lines = await this.planLines(plan, bought, input.interval, input.seats, now, end);
    // An upgrade starts now: what is left of the paid period comes off the price (at the price it was bought for).
    if (isPaid(current) && ['active', 'cancelled'].includes(sub.state) && sub.currentPeriodStart && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
      const len = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime();
      const credit = Math.round((sub.seats * (await this.unit(current, sub, sub.interval)) * (sub.currentPeriodEnd.getTime() - now.getTime())) / Math.max(1, len));
      if (credit > 0) lines.push({ description: `Unused time on the ${selectionName(current, sub, await this.catalogue())} plan (credit)`, sac: SAC_SAAS, quantity: 1, unitPrice: -credit, amount: -credit, periodStart: iso(now), periodEnd: iso(sub.currentPeriodEnd) });
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
        modules: sel.modules,
        ai: sel.ai,
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
    const out = { id: s.id, plan: s.plan, planName: selectionName(plan, s, await this.catalogue()), modules: planModules(plan, s.modules), ai: s.ai, interval: s.interval, seats: s.seats, lines: s.lines, subtotal: s.subtotal, cgst: s.cgst, sgst: s.sgst, igst: s.igst, total: s.total, companyName: c?.name ?? '', status, gateway: s.gateway };
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
    const prev = { plan: await this.plan(sub.plan), modules: sub.modules };
    await tx
      .update(subscriptions)
      .set({
        plan: s.plan,
        modules: s.modules,
        ai: s.ai,
        interval: s.interval,
        state: 'active',
        stateSince: now,
        seats: s.seats,
        nextPeriodSeats: null,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        gateway: gatewayName,
        // PLAN.md §24.4: a "Buy now" company is paid: no longer waiting (its trial, if any, ends here too).
        payBy: null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.companyId, s.companyId));
    const pending = await this.pendingSeatLines(s.companyId, tx);
    const invoice = await this.createInvoice(tx, s.companyId, { issuedAt: now, periodStart: now, periodEnd: end, lines: s.lines, checkoutSessionId: s.id, total: s.total });
    if (pending.ids.length) await tx.update(seatChanges).set({ invoiceId: invoice.id }).where(inArray(seatChanges.id, pending.ids));
    await tx.insert(payments).values({ companyId: s.companyId, invoiceId: invoice.id, checkoutSessionId: s.id, gateway: gatewayName, gatewayPaymentId: event.paymentId ?? null, amount: s.total, status: 'captured' });
    const plan = await this.plan(s.plan);
    // A "Buy now" company gets its apps now (set up with the plan's switches); everyone else: the plan's switches.
    after.push(() => (sub.setupPending ? this.finishSetup(s.companyId) : this.applyEntitlements(s.companyId, plan, s.modules, prev)));
    // PLAN.md §24.5: the GST invoice by email (never fails the payment).
    after.push(() => this.emailInvoice(invoice.id));
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
    const lines = [...(await this.planLines(plan, sub, sub.interval, seats, start, end, tx)), ...pending.lines];
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
    return invoice.id;
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
        const amount = Math.round(((seats - sub.seats) * (await this.unit(plan, sub, sub.interval, tx)) * left) / Math.max(1, len));
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
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      issuedAt: iso(r.issuedAt),
      periodStart: iso(r.periodStart),
      periodEnd: iso(r.periodEnd),
      subtotal: r.subtotal,
      tax: r.cgst + r.sgst + r.igst,
      total: r.total,
      status: r.status,
      // PLAN.md §24.5: the invoice email.
      emailedAt: iso(r.emailedAt),
      emailedTo: r.emailedTo ?? [],
      emailError: r.emailError,
    }));
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
      // PLAN.md §24.1: Free is no longer offered; only companies from before keep it as a choice.
      if (!sub.freeFallback) throw new BadRequestException('The Free plan is no longer offered. Choose modules or Complete to keep using Kaampilot.');
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
      // PLAN.md §24.1: a trial or a cancelled plan ends read-only (until a plan is paid); companies from before §24.1
      // (free_fallback) still drop to Free when they fit it.
      const toFreeOrReadOnly = async (at: Date) => {
        if (sub.freeFallback && (await this.fitsFree(tx, companyId))) {
          await set({ plan: 'free', state: 'active', stateSince: at, seats: 0, nextPeriodSeats: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
          const free = await this.plan('free');
          after.push(() => this.applyEntitlements(companyId, free));
        } else {
          await set({ state: 'read_only', stateSince: at, cancelAtPeriodEnd: false });
        }
      };

      if (plan.code === 'complimentary') return false;
      if (sub.state === 'pending_payment') {
        // PLAN.md §24.4: not paid in time → cleaned up (only while there is nothing but the owner); never a step more.
        const due = sub.payBy ?? new Date(sub.stateSince.getTime() + PENDING_PAY_DAYS * DAY_MS);
        if (due <= now) await this.cleanupPending(tx, sub);
        return false;
      }
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
        if (!manual && opts.forceRenewal) return this.renew(tx, sub, plan, now, opts.renewalOutcome ?? 'success', true, after);
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
        return this.renew(tx, sub, plan, now, opts.renewalOutcome ?? 'success', !!opts.forceRenewal, after);
      }
      return false;
    });
  }

  /**
   * Charges the next period through FakePay. Paid: a new period (seats lowered for it if asked) and an invoice with
   * the pro-rata seat lines. Failed: past_due from the end of the paid period.
   */
  private async renew(tx: Executor, sub: SubscriptionRow, plan: PlanRow, now: Date, outcome: 'success' | 'failure', forced: boolean, after?: After): Promise<boolean> {
    const companyId = sub.companyId;
    const fake = this.fake;
    const start = forced || sub.state === 'past_due' ? now : (sub.currentPeriodEnd ?? now);
    const seats = sub.nextPeriodSeats ?? sub.seats;
    const lines = [...(await this.planLines(plan, sub, sub.interval, seats, start, addInterval(start, sub.interval), tx)), ...(await this.pendingSeatLines(companyId, tx)).lines];
    const tax = gst(lines, (await this.buyer(companyId)).state);
    const charge = await fake.chargeRenewal({ companyId, amount: tax.total, outcome });
    if (!charge.ok) return this.renewalFailed(tx, sub, now, forced, fake.name, charge, tax.total);
    const invoiceId = await this.recordRenewal(tx, sub, plan, now, { gatewayName: fake.name, paymentId: charge.paymentId, forced });
    after?.push(() => this.emailInvoice(invoiceId));
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

  /**
   * PLAN.md §24.4: removes a "Buy now" company that was not paid in time. Only while there is nothing but its owner:
   * apps never set up, one person, no paid payment, no invoice; anything more is kept (logged) for staff to decide.
   * The owner's account goes too when it has no other company (they can simply sign up again).
   */
  private async cleanupPending(tx: Executor, sub: SubscriptionRow): Promise<boolean> {
    const id = sub.companyId;
    const [c] = await tx.select({ code: companies.code }).from(companies).where(eq(companies.id, id)).limit(1);
    if (!c) return false;
    const count = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
    const n = sql<number>`count(*)::int`;
    const members = await tx.select({ id: people.id, accountId: people.accountId }).from(people).where(eq(people.companyId, id));
    const paid = await count(tx.select({ n }).from(payments).where(and(eq(payments.companyId, id), eq(payments.status, 'captured'))));
    const issued = await count(tx.select({ n }).from(invoices).where(eq(invoices.companyId, id)));
    if (!sub.setupPending || members.length > 1 || paid || issued) {
      this.log.warn(`Pending company ${c.code} was not paid in time but has data (people ${members.length}, payments ${paid}, invoices ${issued}): kept`);
      platformLog({ level: 'warn', event: 'billing.pending_kept', message: `${c.code}: not paid within ${PENDING_PAY_DAYS} days but has data; kept for staff`, companyId: id });
      return false;
    }
    await tx.delete(payments).where(eq(payments.companyId, id));
    await tx.delete(checkoutSessions).where(eq(checkoutSessions.companyId, id));
    await tx.delete(seatChanges).where(eq(seatChanges.companyId, id));
    await tx.delete(billingProfiles).where(eq(billingProfiles.companyId, id));
    await tx.delete(invites).where(eq(invites.companyId, id));
    await tx.delete(eventCursors).where(eq(eventCursors.companyId, id));
    await tx.delete(roles).where(eq(roles.companyId, id));
    await tx.delete(people).where(eq(people.companyId, id));
    await tx.delete(departments).where(eq(departments.companyId, id));
    await tx.delete(subscriptions).where(eq(subscriptions.companyId, id));
    await tx.delete(companies).where(eq(companies.id, id));
    for (const accountId of new Set(members.map((m) => m.accountId).filter((a): a is string => !!a))) {
      const others = await count(tx.select({ n }).from(people).where(eq(people.accountId, accountId)));
      if (!others) await tx.delete(accounts).where(eq(accounts.id, accountId));
    }
    this.log.log(`Pending company ${c.code} not paid within ${PENDING_PAY_DAYS} days: removed`);
    platformLog({ level: 'info', event: 'billing.pending_removed', message: `${c.code}: "Buy now" company not paid in time, removed (nothing but the owner)` });
    return true;
  }

  // ─── GST invoice email (PLAN.md §24.5) ─────────────────────────────────

  /** Why invoice emails cannot go out on this server; null = they can. */
  invoiceEmailProblem(): string | null {
    if (!resendConfig().config) return 'Email is not set up (RESEND_API_KEY)';
    return sellerProblem();
  }

  /** Who gets a company's invoices: its owners' emails and the billing email (GST details). */
  private async invoiceRecipients(companyId: string): Promise<string[]> {
    const owners = await this.dbs.db
      .select({ email: people.email, accountEmail: accounts.email })
      .from(people)
      .leftJoin(accounts, eq(accounts.id, people.accountId))
      .where(and(eq(people.companyId, companyId), eq(people.platformRole, 'owner'), eq(people.status, 'active')));
    const profile = await this.profile(companyId);
    return recipients([...owners.map((o) => o.accountEmail ?? o.email), profile?.email]);
  }

  /**
   * Emails one invoice with its PDF to the owner(s) and the billing email, through Resend. Never throws for a mail
   * problem: the outcome (sent at / to, or the last error) is stored on the invoice for the Billing page and the console.
   * Skipped, with the reason stored, when Resend is not set up or (production) the seller's GST details are not set.
   * Never logs the PDF or the key.
   */
  async emailInvoice(invoiceId: string, fetchImpl?: typeof fetch): Promise<{ sent: boolean; to: string[]; error: string | null; emailedAt: string | null }> {
    const [row] = await this.dbs.db.select({ companyId: invoices.companyId, number: invoices.number }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!row) throw notFound('Invoice');
    const record = async (error: string | null, to: string[]) => {
      const at = error ? null : new Date();
      await this.dbs.db
        .update(invoices)
        .set(at ? { emailedAt: at, emailedTo: to, emailError: null } : { emailError: error })
        .where(eq(invoices.id, invoiceId));
      return { sent: !!at, to, error, emailedAt: at ? at.toISOString() : null };
    };
    const { config } = resendConfig();
    const problem = !config ? 'Email is not set up (RESEND_API_KEY)' : sellerProblem();
    if (problem || !config) {
      this.log.warn(`Invoice ${row.number}: email not sent: ${problem}`);
      platformLog({ level: 'warn', event: 'billing.invoice_email', message: `${row.number} not emailed: ${problem}`, companyId: row.companyId });
      return record(problem, []);
    }
    const to = await this.invoiceRecipients(row.companyId);
    if (!to.length) {
      platformLog({ level: 'warn', event: 'billing.invoice_email', message: `${row.number} not emailed: no owner or billing email`, companyId: row.companyId });
      return record('No email address: add a billing email in Billing, GST details', []);
    }
    try {
      const inv = await this.invoice(row.companyId, invoiceId);
      const mail = invoiceEmail(inv, { webUrl: process.env.PUBLIC_WEB_URL });
      const sent = await sendResendMail(config, { to, ...mail, attachments: [{ filename: invoiceFileName(inv.number), content: invoicePdf(inv) }] }, fetchImpl);
      this.log.log(`Invoice ${row.number} emailed (Resend ${sent.id}) to ${to.length} address${to.length === 1 ? '' : 'es'}`);
      platformLog({ level: 'info', event: 'billing.invoice_email', message: `${row.number} emailed to ${to.length} address${to.length === 1 ? '' : 'es'}`, companyId: row.companyId });
      return record(null, to);
    } catch (err) {
      const message = err instanceof MailError ? err.message : `Could not make the email: ${(err as Error).message}`.slice(0, 300);
      this.log.warn(`Invoice ${row.number}: email failed: ${message}`);
      platformLog({ level: 'warn', event: 'billing.invoice_email', message: `${row.number} email failed: ${message}`, companyId: row.companyId });
      return record(message, to);
    }
  }

  /** "Send again" (Billing, Invoices): this company's invoice only. */
  async resendInvoice(companyId: string, invoiceId: string) {
    const [row] = await this.dbs.db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1);
    if (!row) throw notFound('Invoice');
    return this.emailInvoice(invoiceId);
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
        // PLAN.md §24.4: a paid "Buy now" company whose app set-up failed is set up again.
        const unfinished = await this.dbs.db.select({ id: subscriptions.companyId }).from(subscriptions).where(and(eq(subscriptions.setupPending, true), ne(subscriptions.state, 'pending_payment')));
        for (const u of unfinished) await this.finishSetup(u.id).catch((err) => this.log.warn(`App set-up for company ${u.id}: ${(err as Error).message}`));
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
   * The plan's apps become the company's apps, and its module switches follow the plan (PLAN.md §16, §24.1). A new app
   * is set up in that app and opened for the people whose roles reach it; an app the plan lacks is switched off for the
   * company. Tasks-app modules the plan does not include (Visitors and Payroll without Complete; leads, AI inbox,
   * mistakes, links without the Tasks module) are switched off; the ones the new plan adds are switched on (a new
   * Complete: every one), the rest stay as the company set them. Nothing is deleted: switching back brings everything
   * back. Complimentary keeps whatever the company has.
   */
  async applyEntitlements(companyId: string, plan: PlanRow, modules: readonly string[] | null = null, prev?: { plan: PlanRow; modules: readonly string[] | null }) {
    if (plan.code === 'complimentary') return;
    const want = appsFor(plan, modules).filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps, modules: companies.modules }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!c) return;
    const have = c.apps.filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
    const added = want.filter((a) => !have.includes(a));
    const removed = have.filter((a) => !want.includes(a));
    // The Tasks app's switches under the new plan.
    const switches: Record<string, boolean> = { ...(c.modules?.tasks ?? {}) };
    let switched = false;
    if (want.includes('tasks')) {
      const newComplete = plan.kind === 'bundle' && prev?.plan.code !== plan.code;
      for (const key of Object.keys(TASKS_MODULE_NEEDS)) {
        const allowed = tasksModuleAllowed(key, plan, modules);
        const before = prev ? tasksModuleAllowed(key, prev.plan, prev.modules) : true;
        const value = !allowed ? false : newComplete || !before ? true : undefined;
        if (value !== undefined && switches[key] !== value) {
          switches[key] = value;
          switched = true;
        }
      }
    }
    // The Tasks / Attendance split changed (e.g. Tasks → Tasks + Attendance): the Tasks app must hear it (push below).
    const was = prev ? planAreas(prev.plan, prev.modules) : null;
    const now = planAreas(plan, modules);
    const areasChanged = want.includes('tasks') && (!was || was.tasks !== now.tasks || was.attendance !== now.attendance);
    if (!added.length && !removed.length && !switched && !areasChanged) return;
    await this.dbs.db
      .update(companies)
      .set({ enabledApps: want, ...(switched ? { modules: { ...(c.modules ?? {}), tasks: switches } } : {}), updatedAt: new Date() })
      .where(eq(companies.id, companyId));
    this.log.log(`Company ${companyId} on ${plan.code}${modules ? ` (${cleanModules(modules).join(', ')})` : ''}: apps ${want.join(', ') || 'none'}`);
    try {
      // addApps pushes the profile (with the switches) too.
      if (added.length) await this.setup.addApps(companyId, added);
      else await this.company.push(companyId);
    } catch (err) {
      this.log.error(`Plan change for company ${companyId}: ${(err as Error).message} (npm run company -- sync repairs it)`);
    }
  }

  // ─── owner console (Kaampilot staff) ─────────────────────────────────

  private mrrOf(sub: { state: string; seats: number; interval: string } & Bought, plan: PlanRow, catalogue: ModulePriceRow[]) {
    if (!['active', 'past_due', 'cancelled'].includes(sub.state) || plan.priceMonthly === 0) return 0;
    const unit = unitPrice(plan, sub, catalogue, sub.interval);
    return sub.interval === 'year' ? Math.round((sub.seats * unit) / 12) : sub.seats * unit;
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
        modules: subscriptions.modules,
        ai: sql<boolean>`coalesce(${subscriptions.ai}, false)`,
        trialMaxUsers: subscriptions.trialMaxUsers,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        payBy: subscriptions.payBy,
        setupPending: sql<boolean>`coalesce(${subscriptions.setupPending}, false)`,
        billingEmail: sql<string | null>`(select bp.email from ${billingProfiles} bp where bp.company_id = ${companies.id})`,
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
    const catalogue = await this.catalogue();
    return rows.map((r) => {
      const plan = planRows.find((p) => p.code === r.plan)!;
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        owner: r.owner,
        apps: r.apps,
        plan: r.plan,
        planName: plan ? selectionName(plan, r, catalogue) : r.plan,
        /** PLAN.md §24.1: picked modules (null = all) and AI. */
        modules: plan ? planModules(plan, r.modules) : null,
        ai: r.ai,
        state: r.state,
        interval: r.interval,
        seats: { used: r.used, paid: plan && plan.priceMonthly > 0 ? r.seats : 0 },
        mrr: plan ? this.mrrOf(r, plan, catalogue) : 0,
        /** While trialing: the users the trial allows (older trials: 50). */
        trialMaxUsers: r.state === 'trialing' ? (r.trialMaxUsers ?? TRIAL_SEAT_LIMIT) : r.trialMaxUsers,
        trialEndsAt: iso(r.trialEndsAt),
        currentPeriodEnd: iso(r.currentPeriodEnd),
        /** PLAN.md §24.4: a "Buy now" company waiting for its first payment is cleaned up after this. */
        payBy: iso(r.payBy),
        setupPending: r.setupPending,
        /** PLAN.md §24.5: invoices also go here (besides the owner). */
        billingEmail: r.billingEmail,
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
      pendingPayment: count((c) => c.state === 'pending_payment'),
      seatsUsed: list.reduce((s, c) => s + c.seats.used, 0),
      /** PLAN.md §24.5: why invoice emails are not sent on this server (null = they are). */
      invoiceEmail: this.invoiceEmailProblem(),
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
        .set({
          plan: 'complete',
          modules: null,
          ai: false,
          state: 'trialing',
          stateSince: now,
          trialEndsAt: new Date(from.getTime() + days * DAY_MS),
          ...(sub.trialMaxUsers === null && sub.state !== 'trialing' ? { trialMaxUsers: (await this.trialDefaults(tx)).maxUsers } : {}),
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          payBy: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.companyId, companyId));
    });
    await this.finishSetup(companyId); // a "Buy now" company that staff put on a trial gets its apps now
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /**
   * PUT console/companies/:id/trial (PLAN.md §24.1): this company's trial, overriding the defaults: `days` = its length
   * from the trial's start (the company's creation), `maxUsers` = its users. A trial that ended read-only without any
   * payment starts again when the new end is later; a paid or complimentary plan only keeps the numbers for later.
   */
  async consoleTrialOverride(companyId: string, input: z.infer<typeof companyTrialSchema>) {
    await this.assertCompany(companyId);
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      const now = companyNow(sub);
      const set: Partial<SubscriptionRow> = { updatedAt: new Date() };
      if (input.maxUsers !== undefined) set.trialMaxUsers = input.maxUsers;
      if (input.days !== undefined) {
        const end = new Date(sub.createdAt.getTime() + input.days * DAY_MS);
        const neverPaid = !sub.currentPeriodStart && sub.plan !== 'complimentary' && sub.plan !== 'free';
        if (sub.state === 'trialing') set.trialEndsAt = end;
        else if (neverPaid && ['read_only', 'suspended'].includes(sub.state) && end > now) Object.assign(set, { state: 'trialing', stateSince: now, trialEndsAt: end });
        else if (sub.state !== 'trialing') throw new BadRequestException('This company is not on a trial. Use "Extend trial" to start a new one.');
      }
      await tx.update(subscriptions).set(set).where(eq(subscriptions.companyId, companyId));
    });
    await this.tick(companyId); // a shorter trial may have ended already
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /** Sets a plan without payment (a staff decision: complimentary, a deal paid by bank transfer…). */
  async consolePlan(companyId: string, planCode: string, seats: number, picked?: { modules?: string[]; ai?: boolean }) {
    await this.assertCompany(companyId);
    const sel = ['modules', 'complete'].includes(planCode) ? normaliseSelection({ plan: planCode, modules: picked?.modules, ai: picked?.ai }) : { plan: planCode, modules: null, ai: !!picked?.ai };
    const plan = await this.plan(sel.plan);
    let prev: { plan: PlanRow; modules: string[] | null } | undefined;
    let setupPending = false;
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      setupPending = sub.setupPending;
      prev = { plan: await this.plan(sub.plan), modules: sub.modules };
      const now = companyNow(sub);
      const paid = isPaid(plan);
      // A staff-set plan is not charged by any gateway.
      await tx
        .update(subscriptions)
        .set({
          plan: plan.code,
          modules: sel.modules,
          ai: sel.ai,
          state: 'active',
          stateSince: now,
          seats: paid ? Math.max(seats, plan.minSeats) : 0,
          nextPeriodSeats: null,
          currentPeriodStart: paid ? now : null,
          currentPeriodEnd: paid ? addInterval(now, sub.interval) : null,
          cancelAtPeriodEnd: false,
          gateway: null,
          payBy: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.companyId, companyId));
    });
    // A "Buy now" company gets its apps now (PLAN.md §24.4); everyone else: the plan's apps and switches.
    if (setupPending) await this.finishSetup(companyId);
    else await this.applyEntitlements(companyId, plan, sel.modules, prev);
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /**
   * POST console/companies/:id/mark-paid (PLAN.md §24.4): a "Buy now" company paid outside the gateway (bank transfer):
   * the plan it chose starts now for one period, without a gateway; its apps are set up.
   */
  async consoleMarkPaid(companyId: string) {
    await this.assertCompany(companyId);
    const { sub } = await subscriptionOf(this.dbs, companyId);
    if (sub.state !== 'pending_payment') throw new BadRequestException('This company is not waiting for a payment.');
    return this.consolePlan(companyId, sub.plan, sub.seats, { modules: sub.modules ?? undefined, ai: sub.ai });
  }

  /** POST console/companies/:id/pending-extend: more days before an unpaid "Buy now" company is cleaned up. */
  async consoleExtendPending(companyId: string, days: number) {
    await this.assertCompany(companyId);
    await this.dbs.tx(async (tx) => {
      const sub = await this.lockSub(tx, companyId);
      if (sub.state !== 'pending_payment') throw new BadRequestException('This company is not waiting for a payment.');
      const now = companyNow(sub);
      const from = sub.payBy && sub.payBy > now ? sub.payBy : now;
      await tx.update(subscriptions).set({ payBy: new Date(from.getTime() + days * DAY_MS), updatedAt: new Date() }).where(eq(subscriptions.companyId, companyId));
    });
    return (await this.consoleCompanies()).find((c) => c.id === companyId);
  }

  /** PUT console/companies/:id/billing-email (PLAN.md §24.5): where invoices go besides the owner; null clears it. */
  async consoleBillingEmail(companyId: string, email: string | null) {
    await this.assertCompany(companyId);
    const existing = await this.profile(companyId);
    if (existing) await this.dbs.db.update(billingProfiles).set({ email, updatedAt: new Date() }).where(eq(billingProfiles.companyId, companyId));
    else {
      const [c] = await this.dbs.db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
      await this.dbs.db.insert(billingProfiles).values({ companyId, legalName: c?.name ?? 'Customer', state: seller().state, email });
    }
    return { email };
  }

  /** POST console/invoices/:id/email: "Send again" from the console (any company). */
  async consoleEmailInvoice(invoiceId: string) {
    return this.emailInvoice(invoiceId);
  }

  /** The company an invoice belongs to (for the staff audit row). */
  async invoiceCompany(invoiceId: string): Promise<string> {
    const [r] = await this.dbs.db.select({ companyId: invoices.companyId }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!r) throw notFound('Invoice');
    return r.companyId;
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
      const trialRunning = (sub.plan === 'suite' || sub.plan === 'complete') && !sub.currentPeriodEnd && sub.trialEndsAt && sub.trialEndsAt > now;
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
      .select({
        code: companies.code,
        plan: subscriptions.plan,
        modules: subscriptions.modules,
        ai: subscriptions.ai,
        state: subscriptions.state,
        seats: subscriptions.seats,
        trialMaxUsers: subscriptions.trialMaxUsers,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(companies)
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!r) return null;
    return {
      code: r.code,
      state: { plan: r.plan ?? 'complimentary', modules: r.modules ?? null, ai: r.ai ?? false, state: r.state ?? 'active', seats: r.seats ?? 0, trialMaxUsers: r.trialMaxUsers ?? null, trialEndsAt: iso(r.trialEndsAt), currentPeriodEnd: iso(r.currentPeriodEnd) },
    };
  }

  /**
   * Runs one console change and writes one staff_audit row for it: who, from where, what was asked, the company's plan
   * before and after. A change that fails (404, bad plan) writes nothing.
   */
  async consoleAction<T>(staff: StaffActor, ip: string | undefined, action: ConsoleAction, companyId: string | null, input: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const before = companyId ? await this.consoleSnapshot(companyId) : null;
    const result = await run();
    const afterState = companyId ? await this.consoleSnapshot(companyId) : null;
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
export const CONSOLE_ACTIONS = ['trial.extend', 'trial.set', 'trial.defaults', 'plan.set', 'company.suspend', 'company.reactivate', 'pending.mark_paid', 'pending.extend', 'billing.email', 'invoice.email'] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];
/** Read-only console views of a company's or person's data, also in the staff audit log (PLAN.md §21.9). */
export const VIEW_ACTIONS = ['view.company', 'view.user', 'view.users', 'view.billing', 'view.logs'] as const;
export const auditQuerySchema = z.object({
  company: z.string().trim().max(80).optional(),
  action: z.enum([...CONSOLE_ACTIONS, ...VIEW_ACTIONS]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
