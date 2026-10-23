import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService, hashPassword, type Issued, type Meta } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import { stateName } from '../billing/gst';
import { badRequest, type Caller } from '../common/http';
import { CompanySetupService } from '../company/setup.service';
import { assertCompanyNameFree, COMPANY_NAME_MAX, companyNameAvailability } from '../company/company-name';
import { DbService } from '../db/db.service';
import { accounts, APPS, companies, logins, people } from '../db/schema';
import { type Identifier, normaliseIdentifier } from './identifier';
import { OtpService, TicketsService } from './otp.service';
import { assertUsernameFree, lockUsername, USERNAME_MESSAGES, usernameConflict, usernameRefused, usernameShape, usernameTaken } from './username';

/** A verified identifier stays usable for sign-up this long (PLAN.md §21.2). */
export const SIGNUP_TTL_MS = 30 * 60 * 1000;
/** New companies one account may create per day (abuse guard, §20.5). */
const COMPANIES_PER_DAY = 5;

const identifierSchema = z.string().trim().min(3, 'Enter your email or mobile number').max(200);
export const startSchema = z.object({ identifier: identifierSchema });
export const verifySchema = z.object({ otpId: z.string().uuid('Ask for a new code'), code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code') });
export const newPasswordSchema = z.string().min(6, 'Use at least 6 characters').max(200);
export const companySchema = z.object({
  name: z.string().trim().min(2, 'Enter the company name').max(COMPANY_NAME_MAX, `At most ${COMPANY_NAME_MAX} characters`),
  teamSize: z.string().trim().max(20).optional().nullable(),
  industry: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(60).optional().nullable().refine((s) => !s || !!stateName(s), 'Choose a state'),
  apps: z.array(z.enum(APPS)).min(1, 'Choose at least one app').max(APPS.length),
});
export const completeSchema = z.object({
  signupToken: z.string().min(20).max(200),
  /** Not needed when the identifier already has an account (its name is kept). */
  fullName: z.string().trim().max(120).default(''),
  password: z.string().min(1, 'Enter a password').max(200),
  /** Required for a new account (PLAN.md §21.5); ignored for an existing one. */
  username: z.string().trim().max(60).optional(),
  company: companySchema,
  client: z.enum(['web', 'mobile']).default('web'),
});
export const forgotSchema = z.object({ identifier: identifierSchema });
export const resetVerifySchema = verifySchema;
export const resetSchema = z.object({ otpId: z.string().uuid('Ask for a new code'), code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code'), newPassword: newPasswordSchema });
export type CompanyInput = z.infer<typeof companySchema>;

export type AccountRow = typeof accounts.$inferSelect;

const expired = () => new BadRequestException({ message: 'Your sign-up has expired. Start again.', errors: { signupToken: 'Expired' } });
const invalidIdentifier = () => badRequest('Enter a valid email or a 10-digit Indian mobile number', { identifier: 'Enter a valid email or mobile number' });
/** Forgot password with something that is not an email or mobile number: a username or employee ID made by an admin. */
const adminResets = () =>
  badRequest('Usernames and employee IDs are reset by your company admin. Ask them to reset your password, or enter the email or mobile number of your Kaampilot account.', {
    identifier: 'Enter the email or mobile number of your account',
  });
const askAdmin = () =>
  badRequest('This email signs in with a login your company admin made, so only your admin can reset its password. Ask them to reset it.', { code: 'Admin login' });
const noAccount = () => badRequest('There is no Kaampilot account with this email or mobile number. Check it, or sign up instead.', { code: 'No account' });

/**
 * Accounts (PLAN.md §21): sign-up by one-time code, forgot password, and new companies for an account. Sign-in with an
 * account and the company switcher live in AuthService.
 */
@Injectable()
export class AccountsService {
  private readonly log = new Logger('Signup');

  constructor(
    private readonly dbs: DbService,
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly tickets: TicketsService,
    private readonly setup: CompanySetupService,
    private readonly billing: BillingService,
  ) {}

  async findAccount(id: Identifier): Promise<AccountRow | undefined> {
    const [a] = await this.dbs.db
      .select()
      .from(accounts)
      .where(id.kind === 'email' ? sql`lower(${accounts.email}) = ${id.value}` : eq(accounts.mobile, id.value))
      .limit(1);
    return a;
  }

  async accountOfPerson(personId: string): Promise<AccountRow | undefined> {
    const [row] = await this.dbs.db.select({ account: accounts }).from(people).innerJoin(accounts, eq(accounts.id, people.accountId)).where(eq(people.id, personId)).limit(1);
    return row?.account;
  }

  /** GET companies/name-available (PLAN.md §21.6); `exceptCompanyId`: the caller renaming its own company. */
  companyNameAvailable(raw: string, exceptCompanyId?: string | null) {
    return companyNameAvailability(this.dbs.db, raw, exceptCompanyId);
  }

  // ─── usernames (PLAN.md §21.5) ──────────────────────────────────────────

  /** GET auth/username-available: free, taken, malformed or reserved (the caller's own name counts as free). */
  async usernameAvailable(raw: string, exceptAccountId?: string | null) {
    const shape = usernameShape(raw);
    if (!shape.ok) return { available: false, reason: shape.reason, message: USERNAME_MESSAGES[shape.reason] };
    if (await usernameTaken(this.dbs.db, shape.value, { accountId: exceptAccountId })) return { available: false, reason: 'taken' as const, message: USERNAME_MESSAGES.taken };
    return { available: true, username: shape.value, message: 'Available' };
  }

  /** PUT auth/username: the signed-in account adds or changes its username (one for all its companies). */
  async setUsername(caller: Caller, raw: string) {
    const account = await this.accountOfPerson(caller.personId);
    if (!account) throw new ForbiddenException('Your username is set by your company admin.');
    const username = await this.dbs.tx(async () => {
      const shape = usernameShape(raw);
      if (!shape.ok) throw usernameRefused(shape.reason);
      await lockUsername(this.dbs.db, shape.value);
      const value = await assertUsernameFree(this.dbs.db, shape.value, { accountId: account.id });
      await this.dbs.db.update(accounts).set({ username: value, updatedAt: new Date() }).where(eq(accounts.id, account.id));
      return value;
    });
    return { ok: true, username };
  }

  // ─── sign-up ────────────────────────────────────────────────────────────

  async signupStart(identifier: string, ip?: string) {
    const id = normaliseIdentifier(identifier);
    if (!id) throw invalidIdentifier();
    return this.otp.start(id, 'signup', ip);
  }

  /**
   * The code proves the identifier: a sign-up token for 30 minutes. An email that already signs in with an admin-made
   * login (no account) cannot become an account here: they sign in with it (no take-over of a login of a company).
   */
  async signupVerify(otpId: string, code: string) {
    const { target, channel } = await this.otp.verify(otpId, code, 'signup');
    const id = normaliseIdentifier(target)!;
    const account = await this.findAccount(id);
    if (!account) await this.assertNotCompanyLogin(id);
    const signupToken = await this.tickets.create('signup', SIGNUP_TTL_MS, { target, channel });
    return { signupToken, accountExists: !!account };
  }

  private async assertNotCompanyLogin(id: Identifier) {
    if (id.kind !== 'email') return;
    const [legacy] = await this.dbs.db
      .select({ id: people.id })
      .from(people)
      .innerJoin(logins, eq(logins.personId, people.id))
      .where(and(sql`lower(${people.email}) = ${id.value}`, isNull(people.accountId)))
      .limit(1);
    if (legacy) throw new ConflictException('This email already signs in to a company here. Sign in with it instead, or use another email.');
  }

  /**
   * Step 1 of using a sign-up token (outside any transaction, so a wrong password still counts towards the lockout when `LOGIN_MAX_FAILED` is on):
   * the identifier it proves, and the existing account, whose password must be right. A new account's password is checked.
   */
  async checkSignup(signupToken: string, password: string, ip?: string, fullName?: string, username?: string): Promise<{ id: Identifier; existing?: AccountRow; username?: string }> {
    const ticket = await this.tickets.peek(signupToken, 'signup');
    const id = ticket?.target ? normaliseIdentifier(ticket.target) : null;
    if (!ticket || !id) throw expired();
    const existing = await this.findAccount(id);
    if (existing) {
      await this.auth.verifyAccountPassword(existing, password, `ip:${ip ?? 'unknown'}`);
      return { id, existing };
    }
    if (!fullName?.trim()) throw badRequest('Enter your name', { fullName: 'Enter your name' });
    if (!username?.trim()) throw badRequest('Choose a username', { username: 'Choose a username' });
    const shape = usernameShape(username);
    if (!shape.ok) throw usernameRefused(shape.reason);
    const pw = newPasswordSchema.safeParse(password);
    if (!pw.success) throw badRequest(pw.error.issues[0].message, { password: pw.error.issues[0].message });
    await this.assertNotCompanyLogin(id);
    // Early answer (the transaction checks again under a lock, and the unique index is the last word).
    if (await usernameTaken(this.dbs.db, shape.value)) throw usernameConflict();
    return { id, existing, username: shape.value };
  }

  /** Step 2, inside the caller's transaction: the token is used up (once only) and a new account is created. */
  async takeSignup(signupToken: string, checked: { id: Identifier; existing?: AccountRow; username?: string }, fullName: string, password: string): Promise<AccountRow> {
    if (checked.existing) {
      if (!(await this.tickets.take(signupToken, 'signup'))) throw expired();
      return checked.existing;
    }
    // Two people choosing the same name at the same moment: the lock makes the second one wait and then see it taken
    // (before the sign-up token is used up, so they can simply choose another name).
    const username = checked.username ? (await lockUsername(this.dbs.db, checked.username), await assertUsernameFree(this.dbs.db, checked.username)) : null;
    if (!(await this.tickets.take(signupToken, 'signup'))) throw expired();
    const [account] = await this.dbs.db
      .insert(accounts)
      .values({ fullName, username, email: checked.id.kind === 'email' ? checked.id.value : null, mobile: checked.id.kind === 'mobile' ? checked.id.value : null, passwordHash: await hashPassword(password) })
      .returning();
    return account;
  }

  /** POST signup/complete: account + company + owner + 14-day Suite trial, set up in the apps, signed in. */
  async signupComplete(input: z.infer<typeof completeSchema>, meta: Meta) {
    const checked = await this.checkSignup(input.signupToken, input.password, meta.ip, input.fullName, input.username);
    if (checked.existing) await this.assertCompanyQuota(checked.existing.id);
    const { account, ids } = await this.dbs.tx(async () => {
      const account = await this.takeSignup(input.signupToken, checked, input.fullName, input.password);
      return { account, ids: await this.insertCompany(account, input.company) };
    });
    return this.provisionAndSignIn(account, ids, meta);
  }

  // ─── new company for an account ─────────────────────────────────────────

  /** POST companies: a new company owned by the caller's account; tokens for it (this session ends). */
  async createCompany(caller: Caller, input: CompanyInput, meta: Meta) {
    const account = await this.accountOfPerson(caller.personId);
    if (!account) throw new ForbiddenException('New companies are made from an account. Sign up with your email or mobile number first.');
    const ids = await this.dbs.tx(async () => {
      await this.assertCompanyQuota(account.id);
      return this.insertCompany(account, input);
    });
    const out = await this.provisionAndSignIn(account, ids, meta);
    if (caller.sessionFamily) await this.auth.revokeFamily(caller.sessionFamily);
    return out;
  }

  private async assertCompanyQuota(accountId: string) {
    const [r] = await this.dbs.db
      .select({ n: sql<number>`count(*)::int` })
      .from(people)
      .where(and(eq(people.accountId, accountId), eq(people.platformRole, 'owner'), gt(people.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));
    if ((r?.n ?? 0) >= COMPANIES_PER_DAY) throw new HttpException({ statusCode: 429, message: 'Too many new companies today. Try again tomorrow.' }, 429);
  }

  /** The rows: company (code from its name), its owner (the account's membership), the trial. */
  private async insertCompany(account: AccountRow, input: CompanyInput) {
    // Unique across the product (409 on the field; the lock is held until this transaction ends).
    const name = await assertCompanyNameFree(this.dbs.db, input.name);
    const code = await this.setup.freeCode(name);
    const [company] = await this.dbs.db.insert(companies).values({ name, code, enabledApps: [...new Set(input.apps)] }).returning();
    const [owner] = await this.dbs.db
      .insert(people)
      .values({ companyId: company.id, fullName: account.fullName, email: account.email, mobile: account.mobile, platformRole: 'owner', accountId: account.id })
      .returning({ id: people.id });
    await this.billing.startTrial(this.dbs.db, company.id, { legalName: name, state: input.state ?? null, email: account.email });
    if (input.teamSize || input.industry) this.log.log(`New company ${code}: team ${input.teamSize ?? '?'}, industry ${input.industry ?? '?'}`);
    return { companyId: company.id, ownerId: owner.id, company };
  }

  /**
   * Same steps as `npm run company -- create` (apps, launch modules, roles: the owner gets the apps, profile, people).
   * If an app cannot be reached the person is still signed in (`setupIncomplete`), and the set-up is retried in the
   * background (every step can be repeated safely; `npm run company -- sync` also finishes it).
   */
  private async provisionAndSignIn(
    account: AccountRow,
    ids: { companyId: string; ownerId: string; company: typeof companies.$inferSelect },
    meta: Meta,
  ): Promise<Issued & { companyId: string; provisionMs: number; setupIncomplete: boolean }> {
    const started = Date.now();
    let setupIncomplete = false;
    try {
      await this.setup.provisionNew(ids.company, (line) => this.log.log(line.trim()));
    } catch (err) {
      setupIncomplete = true;
      this.log.error(`Setting up ${ids.company.code} in the apps: ${(err as Error).message}`);
      this.retrySetup(ids.company);
    }
    const provisionMs = Date.now() - started;
    this.log.log(`Company ${ids.company.code} for account ${account.id} set up in ${provisionMs} ms${setupIncomplete ? ' (not finished: retrying)' : ''}`);
    return { ...(await this.auth.issueFor(ids.ownerId, meta)), companyId: ids.companyId, provisionMs, setupIncomplete };
  }

  /** Tries the app set-up again after 30 s, 2 min and 10 min (only in this process; `company -- sync` is the fallback). */
  private retrySetup(company: typeof companies.$inferSelect, delays = [30_000, 120_000, 600_000]) {
    if (!delays.length) {
      this.log.error(`Company ${company.code}: app set-up still failing. Run: npm run company -- sync --code ${company.code}`);
      return;
    }
    const t = setTimeout(() => {
      this.setup
        .provisionNew(company, (line) => this.log.log(line.trim()))
        .then(() => this.log.log(`Company ${company.code}: app set-up finished on retry`))
        .catch((err) => {
          this.log.warn(`Company ${company.code}: app set-up retry failed: ${(err as Error).message}`);
          this.retrySetup(company, delays.slice(1));
        });
    }, delays[0]);
    t.unref?.();
  }

  // ─── forgot password ────────────────────────────────────────────────────

  /** Always the same answer, whether an account exists or not (no account enumeration). */
  async forgot(identifier: string, ip?: string) {
    const id = normaliseIdentifier(identifier);
    if (!id) throw identifier.includes('@') || /^[+0-9 ()-]+$/.test(identifier.trim()) ? invalidIdentifier() : adminResets();
    const { otpId, channel, devCode } = await this.otp.start(id, 'reset', ip);
    return { otpId, channel, ...(devCode ? { devCode } : {}) };
  }

  /**
   * The account a reset code was sent to. The code proves the email / mobile, so only now does the answer say that there
   * is no account, or that the email belongs to an admin-made login (whose password only the company admin resets).
   */
  private async accountForReset(target: string): Promise<AccountRow> {
    const id = normaliseIdentifier(target)!;
    const account = await this.findAccount(id);
    if (account) return account;
    if (id.kind === 'email') {
      const [legacy] = await this.dbs.db
        .select({ id: people.id })
        .from(people)
        .innerJoin(logins, eq(logins.personId, people.id))
        .where(and(sql`lower(${people.email}) = ${id.value}`, isNull(people.accountId)))
        .limit(1);
      if (legacy) throw askAdmin();
    }
    throw noAccount();
  }

  /** POST auth/reset/verify: checks the code on its own step (a wrong one counts as a try); the code stays usable for reset. */
  async resetVerify(otpId: string, code: string) {
    const { target } = await this.otp.verify(otpId, code, 'reset', { consume: false });
    await this.accountForReset(target);
    return { ok: true };
  }

  async reset(otpId: string, code: string, newPassword: string) {
    const { target } = await this.otp.verify(otpId, code, 'reset');
    const account = await this.accountForReset(target);
    await this.dbs.db
      .update(accounts)
      .set({ passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, account.id));
    await this.auth.revokeAccount(account.id);
    return { ok: true };
  }
}
