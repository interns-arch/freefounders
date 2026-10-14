import { ForbiddenException, HttpException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, pbkdf2, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { badRequest, type Caller } from '../common/http';
import { CompanyService } from '../company/company.service';
import { DbService } from '../db/db.service';
import { accounts, authTickets, otpCodes, type AppKey, APPS, companies, logins, people, personApps, type PlatformRole, refreshSessions, subscriptions } from '../db/schema';
import { normaliseIdentifier } from '../accounts/identifier';
import { TicketsService } from '../accounts/otp.service';
import { billingSummary, isReadOnly, paymentRequired, SUSPENDED_MESSAGE } from '../billing/seats';
import { heldAccess, platformPermissionsOf } from '../roles/platform-permissions';
import { ACCESS_TTL_SECONDS, TokensService } from '../keys/tokens.service';
import { ipLimit, NAME_LIMIT, Throttle } from './throttle';

/** "Stay signed in": a refresh session lives until it goes unused this long (founder decision: 1 year). */
export const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Two tabs refreshing at once both present the same token; the slower one is not treated as theft. */
const ROTATION_GRACE_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
/** An account with several companies picks one within this time (PLAN.md §21.2). */
const CHOOSE_TTL_MS = 5 * 60 * 1000;
const WRONG = 'Wrong email / username / employee ID or password';
const LOCKED = 'Too many failed attempts. Try again in a few minutes.';
/** Rotated or revoked refresh rows are kept this long (reuse of a copied token is detected while its row exists). */
const SESSION_HISTORY_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

export const APP_INFO: Record<AppKey, { name: string; path: string }> = {
  tasks: { name: 'Tasks', path: '/tasks/' },
  assets: { name: 'Assets', path: '/assets/' },
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** A Django PBKDF2 hash brought over from Tasks: `pbkdf2_sha256$<iterations>$<salt>$<base64 hash>`. */
export function isImportedHash(stored: string): boolean {
  return stored.startsWith('pbkdf2_sha256$');
}

/** Checks a password against an argon2id hash, or (imported from Tasks) a Django PBKDF2 hash. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  if (!isImportedHash(stored)) return verify(stored, password).catch(() => false);
  const [, iterations, salt, expected] = stored.split('$');
  const rounds = Number(iterations);
  if (!salt || !expected || !Number.isInteger(rounds) || rounds < 1 || rounds > 10_000_000) return false;
  const derived = await new Promise<Buffer>((resolve, reject) =>
    pbkdf2(password, salt, rounds, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key))),
  ).catch(() => null);
  const want = Buffer.from(expected, 'base64');
  return derived !== null && derived.length === want.length && timingSafeEqual(derived, want);
}

export interface Meta {
  ip?: string;
  userAgent?: string;
  client?: 'web' | 'mobile';
}

/** One company an account belongs to (PLAN.md §21). */
export interface Membership {
  personId: string;
  companyId: string;
  name: string;
  code: string;
  role: string;
  state: string | null;
}

/** An account in several companies: pick one with `ticket` (POST auth/login {ticket, companyId}). */
export interface ChooseCompany {
  chooseCompany: Array<{ companyId: string; name: string; code: string; role: string }>;
  ticket: string;
}

export interface Issued {
  accessToken: string;
  expiresIn: number;
  /** null when a token inside the rotation grace period was refreshed: the cookie already holds the newer one. */
  refreshToken: string | null;
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  // Verifying against a dummy hash keeps response time similar for unknown logins.
  private readonly dummyHash = hash(randomBytes(16).toString('hex'));
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly tokens: TokensService,
    private readonly throttle: Throttle,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.FF_CLI === 'true') return;
    this.pruneTimer = setInterval(
      () => void this.pruneSessions().catch((err) => new Logger('Auth').warn(`Session clean-up: ${(err as Error).message}`)),
      PRUNE_EVERY_MS,
    );
    this.pruneTimer.unref();
  }

  onModuleDestroy() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  /**
   * Removes refresh rows nobody can use any more: expired ones, and rotated or revoked ones older than 30 days (a copied
   * token older than that is simply refused instead of also ending the session). Safe on several processes at once.
   */
  async pruneSessions(): Promise<number> {
    let removed = 0;
    for (;;) {
      const res = await this.dbs.db.execute(sql`
        delete from ${refreshSessions} where ${refreshSessions.id} in (
          select ${refreshSessions.id} from ${refreshSessions}
          where ${refreshSessions.expiresAt} < now()
             or ${refreshSessions.revokedAt} < now() - make_interval(days => ${SESSION_HISTORY_DAYS})
             or ${refreshSessions.rotatedAt} < now() - make_interval(days => ${SESSION_HISTORY_DAYS})
          limit 5000)`);
      const n = res.rowCount ?? 0;
      removed += n;
      if (n < 5000) break;
    }
    // One-time codes and sign-up / choose-company tickets are useless a day later (PLAN.md §21).
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.dbs.db.delete(otpCodes).where(lt(otpCodes.createdAt, dayAgo));
    await this.dbs.db.delete(authTickets).where(lt(authTickets.expiresAt, dayAgo));
    return removed;
  }

  /** Email, then username, then employee ID. An employee ID shared by two companies is ambiguous and not accepted. */
  private async findLogin(input: string) {
    const db = this.dbs.db;
    const id = input.trim();
    const cols = { person: people, login: logins, companyStatus: companies.status };
    const base = () => db.select(cols).from(logins).innerJoin(people, eq(people.id, logins.personId)).innerJoin(companies, eq(companies.id, people.companyId));
    if (id.includes('@')) {
      // Admin-made logins only; one email can belong to people of several companies once accounts join them (§21).
      const byEmail = await base().where(sql`lower(${people.email}) = lower(${id})`).limit(2);
      return byEmail.length === 1 ? byEmail[0] : undefined;
    }
    const [named] = await base().where(sql`lower(${logins.username}) = lower(${id})`).limit(1);
    if (named) return named;
    const coded = await base().where(sql`lower(${people.employeeCode}) = lower(${id})`).limit(2);
    return coded.length === 1 ? coded[0] : undefined;
  }

  async login(input: string, password: string, meta: Meta): Promise<(Issued & { mustChangePassword: boolean }) | ChooseCompany> {
    const db = this.dbs.db;
    const ipKey = `ip:${meta.ip ?? 'unknown'}`;
    if (this.throttle.blocked(ipKey, ipLimit())) {
      throw new HttpException('Too many sign-in attempts from your network. Try again in a few minutes.', 429);
    }
    // An account's email or mobile number (PLAN.md §21) comes first; everything else is an admin-made login as before.
    const ident = normaliseIdentifier(input);
    if (ident) {
      const [account] = await db
        .select()
        .from(accounts)
        .where(ident.kind === 'email' ? sql`lower(${accounts.email}) = ${ident.value}` : eq(accounts.mobile, ident.value))
        .limit(1);
      if (account) return this.loginAccount(account, password, meta, ipKey);
    }
    const found = await this.findLogin(input);

    if (!found || found.person.status !== 'active' || found.companyStatus !== 'active') {
      // No usable account: same work and same answers (incl. "too many" after 5 tries) as a real one, so nobody can tell.
      await verifyPassword(await this.dummyHash, password);
      this.throttle.fail(ipKey);
      const nameKey = `name:${input.trim().toLowerCase()}`;
      if (this.throttle.blocked(nameKey, NAME_LIMIT)) throw new UnauthorizedException(LOCKED);
      this.throttle.fail(nameKey);
      throw new UnauthorizedException(WRONG);
    }
    const { login, person } = found;

    // Claim one attempt atomically BEFORE checking the password, so parallel guesses cannot get past the limit: at most
    // MAX_FAILED_LOGINS checks per lock period, however many requests arrive at once. A lock that has run out starts over.
    const [claim] = await db
      .update(logins)
      .set({
        failedLogins: sql`case when ${logins.lockedUntil} is not null and ${logins.lockedUntil} <= now() then 1 else ${logins.failedLogins} + 1 end`,
        lockedUntil: sql`case when ${logins.lockedUntil} <= now() then null else ${logins.lockedUntil} end`,
      })
      .where(
        and(
          eq(logins.personId, person.id),
          or(and(isNull(logins.lockedUntil), lt(logins.failedLogins, MAX_FAILED_LOGINS)), lte(logins.lockedUntil, sql`now()`)),
        ),
      )
      .returning({ failed: logins.failedLogins });
    if (!claim) {
      this.throttle.fail(ipKey);
      throw new UnauthorizedException(LOCKED);
    }
    if (!(await verifyPassword(login.passwordHash, password))) {
      this.throttle.fail(ipKey);
      if (claim.failed >= MAX_FAILED_LOGINS) {
        await db.update(logins).set({ lockedUntil: new Date(Date.now() + LOCK_MS) }).where(eq(logins.personId, person.id));
      }
      throw new UnauthorizedException(WRONG);
    }

    // A password imported from Tasks (Django PBKDF2) is upgraded to argon2id now that we know it.
    const upgrade = isImportedHash(login.passwordHash) ? { passwordHash: await hashPassword(password) } : {};
    await db.update(logins).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), ...upgrade }).where(eq(logins.personId, person.id));
    await this.assertOpen(person.companyId, person.platformRole);
    return { ...(await this.issueFor(person.id, meta)), mustChangePassword: login.mustChangePassword };
  }

  /** A suspended company: only its owners may sign in (straight to Billing). 402 for everyone else. */
  private async assertOpen(companyId: string, role: string) {
    const [s] = await this.dbs.db.select({ state: subscriptions.state }).from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
    if (s?.state === 'suspended' && role !== 'owner') throw paymentRequired(SUSPENDED_MESSAGE);
  }

  /** Tokens for one person (company membership): a new sign-in session. */
  async issueFor(personId: string, meta: Meta): Promise<Issued> {
    const familyId = randomUUID();
    const refreshToken = await this.newRefresh(personId, familyId, meta);
    const accessToken = await this.tokens.signAccess(await this.caller(personId, familyId));
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  /**
   * Sign-in with an account (PLAN.md §21): the same lockout as admin-made logins (5 tries per 15 minutes, claimed
   * atomically before the password is checked), then one company → tokens, several → a choice with a 5-minute ticket.
   */
  private async loginAccount(account: typeof accounts.$inferSelect, password: string, meta: Meta, ipKey: string): Promise<(Issued & { mustChangePassword: boolean }) | ChooseCompany> {
    await this.verifyAccountPassword(account, password, ipKey);
    const all = await this.memberships(account.id);
    const open = all.filter((m) => m.state !== 'suspended' || m.role === 'owner');
    if (!open.length) {
      if (all.length) throw paymentRequired(SUSPENDED_MESSAGE);
      throw new ForbiddenException('Your account is not part of any company yet. Open your invite link again, or sign up to create a company.');
    }
    if (open.length === 1) return { ...(await this.issueFor(open[0].personId, meta)), mustChangePassword: false };
    const ticket = await this.tickets.create('login', CHOOSE_TTL_MS, { accountId: account.id });
    return { chooseCompany: open.map((m) => ({ companyId: m.companyId, name: m.name, code: m.code, role: m.role })), ticket };
  }

  /**
   * An account's password, with the lockout of admin-made logins (one try claimed atomically first; 5 wrong → 15
   * minutes) and the per-IP limit. Used by sign-in, and by sign-up / invites when the account already exists.
   */
  async verifyAccountPassword(account: typeof accounts.$inferSelect, password: string, ipKey: string) {
    if (this.throttle.blocked(ipKey, ipLimit())) throw new HttpException('Too many sign-in attempts from your network. Try again in a few minutes.', 429);
    const db = this.dbs.db;
    const [claim] = await db
      .update(accounts)
      .set({
        failedLogins: sql`case when ${accounts.lockedUntil} is not null and ${accounts.lockedUntil} <= now() then 1 else ${accounts.failedLogins} + 1 end`,
        lockedUntil: sql`case when ${accounts.lockedUntil} <= now() then null else ${accounts.lockedUntil} end`,
      })
      .where(and(eq(accounts.id, account.id), or(and(isNull(accounts.lockedUntil), lt(accounts.failedLogins, MAX_FAILED_LOGINS)), lte(accounts.lockedUntil, sql`now()`))))
      .returning({ failed: accounts.failedLogins });
    if (!claim) {
      this.throttle.fail(ipKey);
      throw new UnauthorizedException(LOCKED);
    }
    if (!(await verifyPassword(account.passwordHash, password))) {
      this.throttle.fail(ipKey);
      if (claim.failed >= MAX_FAILED_LOGINS) await db.update(accounts).set({ lockedUntil: new Date(Date.now() + LOCK_MS) }).where(eq(accounts.id, account.id));
      throw new UnauthorizedException(WRONG);
    }
    await db.update(accounts).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(accounts.id, account.id));
  }

  /** Second step of an account sign-in with several companies. */
  async loginWithTicket(ticket: string, companyId: string, meta: Meta): Promise<Issued & { mustChangePassword: boolean }> {
    const row = await this.tickets.take(ticket, 'login');
    if (!row?.accountId) throw new UnauthorizedException('Please sign in again');
    const m = (await this.memberships(row.accountId)).find((x) => x.companyId === companyId);
    if (!m) throw new UnauthorizedException('Please sign in again');
    if (m.state === 'suspended' && m.role !== 'owner') throw paymentRequired(SUSPENDED_MESSAGE);
    return { ...(await this.issueFor(m.personId, meta)), mustChangePassword: false };
  }

  /** Active people of an account, in active companies, with each company's subscription state. */
  async memberships(accountId: string): Promise<Membership[]> {
    return this.dbs.db
      .select({ personId: people.id, companyId: companies.id, name: companies.name, code: companies.code, role: people.platformRole, state: subscriptions.state })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
      .where(and(eq(people.accountId, accountId), eq(people.status, 'active'), eq(companies.status, 'active')))
      .orderBy(companies.name);
  }

  /** The account's companies for the switcher (an admin-made login: only its own company). */
  async companiesOf(caller: Caller) {
    const [me] = await this.dbs.db.select({ accountId: people.accountId }).from(people).where(eq(people.id, caller.personId)).limit(1);
    if (!me?.accountId) {
      const [c] = await this.dbs.db.select({ id: companies.id, name: companies.name, code: companies.code }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
      return c ? [{ companyId: c.id, name: c.name, code: c.code, role: caller.role, current: true }] : [];
    }
    return (await this.memberships(me.accountId))
      .filter((m) => m.state !== 'suspended' || m.role === 'owner' || m.companyId === caller.companyId)
      .map((m) => ({ companyId: m.companyId, name: m.name, code: m.code, role: m.role, current: m.companyId === caller.companyId }));
  }

  /** Tokens for the same account in another of its companies; the current session ends. */
  async switchCompany(caller: Caller, companyId: string, meta: Meta): Promise<Issued> {
    const [me] = await this.dbs.db.select({ accountId: people.accountId }).from(people).where(eq(people.id, caller.personId)).limit(1);
    const m = me?.accountId ? (await this.memberships(me.accountId)).find((x) => x.companyId === companyId) : undefined;
    if (!m) throw new ForbiddenException('You are not part of that company');
    if (m.state === 'suspended' && m.role !== 'owner') throw paymentRequired(SUSPENDED_MESSAGE);
    const issued = await this.issueFor(m.personId, meta);
    if (caller.sessionFamily) await this.revokeFamily(caller.sessionFamily);
    return issued;
  }

  /** A token's sign-in session is still live and its person active (for public routes that take an optional token). */
  async isLive(caller: Caller): Promise<boolean> {
    if (!caller.sessionFamily) return false;
    const [row] = await this.dbs.db
      .select({ id: refreshSessions.id })
      .from(refreshSessions)
      .innerJoin(people, eq(people.id, refreshSessions.personId))
      .where(and(eq(refreshSessions.familyId, caller.sessionFamily), eq(refreshSessions.personId, caller.personId), isNull(refreshSessions.revokedAt), gt(refreshSessions.expiresAt, sql`now()`), eq(people.status, 'active')))
      .limit(1);
    return !!row;
  }

  /** Every sign-in session of an account (all its companies), optionally keeping one. */
  async revokeAccount(accountId: string, exceptFamily?: string) {
    const ids = (await this.dbs.db.select({ id: people.id }).from(people).where(eq(people.accountId, accountId))).map((p) => p.id);
    if (!ids.length) return;
    await this.dbs.db
      .update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(and(inArray(refreshSessions.personId, ids), isNull(refreshSessions.revokedAt), exceptFamily ? ne(refreshSessions.familyId, exceptFamily) : undefined));
  }

  private async newRefresh(personId: string, familyId: string, meta: Meta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.dbs.db.insert(refreshSessions).values({
      id: sha256(token),
      familyId,
      personId,
      client: meta.client ?? 'web',
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return token;
  }

  /** Builds the token claims from current data, so app grants and deactivation take effect on the next refresh. */
  async caller(personId: string, sessionFamily?: string): Promise<Caller> {
    const db = this.dbs.db;
    const [row] = await db
      .select({ person: people, enabledApps: companies.enabledApps, state: subscriptions.state })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
      .where(eq(people.id, personId))
      .limit(1);
    if (!row) throw new UnauthorizedException('Please sign in');
    const grants = await db.select().from(personApps).where(eq(personApps.personId, personId));
    const apps: Partial<Record<AppKey, string>> = {};
    for (const g of grants) {
      if ((APPS as readonly string[]).includes(g.app) && row.enabledApps.includes(g.app)) apps[g.app as AppKey] = g.localUserId;
    }
    return {
      personId,
      companyId: row.person.companyId,
      name: row.person.fullName,
      role: row.person.platformRole as PlatformRole,
      apps,
      sessionFamily,
      readOnly: isReadOnly(row.state),
    };
  }

  async refresh(token: string | undefined, meta: Meta): Promise<Issued> {
    if (!token || token.length < 20) throw new UnauthorizedException('Please sign in');
    const db = this.dbs.db;
    const id = sha256(token);
    const [session] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, id)).limit(1);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Please sign in');

    const [state] = await db
      .select({ status: people.status, companyStatus: companies.status, hasLogin: logins.personId, accountId: people.accountId, role: people.platformRole, billing: subscriptions.state })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .leftJoin(logins, eq(logins.personId, people.id))
      .leftJoin(subscriptions, eq(subscriptions.companyId, companies.id))
      .where(eq(people.id, session.personId))
      .limit(1);
    const suspended = state?.billing === 'suspended' && state.role !== 'owner';
    if (!state || state.status !== 'active' || state.companyStatus !== 'active' || (!state.hasLogin && !state.accountId) || suspended) {
      await this.revokeFamily(session.familyId);
      throw new UnauthorizedException('Please sign in');
    }

    // Claim the rotation atomically; only one concurrent request wins.
    const [claimed] = await db
      .update(refreshSessions)
      .set({ rotatedAt: new Date() })
      .where(and(eq(refreshSessions.id, id), isNull(refreshSessions.rotatedAt)))
      .returning({ id: refreshSessions.id });

    let refreshToken: string | null = null;
    if (claimed) {
      refreshToken = await this.newRefresh(session.personId, session.familyId, { ...meta, client: session.client as Meta['client'] });
    } else {
      const [again] = await db.select({ rotatedAt: refreshSessions.rotatedAt }).from(refreshSessions).where(eq(refreshSessions.id, id)).limit(1);
      if (!again?.rotatedAt || Date.now() - again.rotatedAt.getTime() > ROTATION_GRACE_MS) {
        // An old token came back long after it was replaced: someone copied it. End the whole session.
        await this.revokeFamily(session.familyId);
        throw new UnauthorizedException('Please sign in');
      }
    }
    const accessToken = await this.tokens.signAccess(await this.caller(session.personId, session.familyId));
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const [session] = await this.dbs.db.select({ familyId: refreshSessions.familyId }).from(refreshSessions).where(eq(refreshSessions.id, sha256(token))).limit(1);
    if (session) await this.revokeFamily(session.familyId);
  }

  async revokeFamily(familyId: string) {
    await this.dbs.db
      .update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshSessions.familyId, familyId), isNull(refreshSessions.revokedAt)));
  }

  /** Signs a person out everywhere (optionally keeping the current session). */
  async revokeAll(personId: string, exceptFamily?: string) {
    await this.dbs.db
      .update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshSessions.personId, personId),
          isNull(refreshSessions.revokedAt),
          exceptFamily ? ne(refreshSessions.familyId, exceptFamily) : undefined,
        ),
      );
  }

  async me(caller: Caller) {
    const db = this.dbs.db;
    const [row] = await db
      .select({
        person: people,
        company: { id: companies.id, name: companies.name, shortName: companies.shortName, colour: companies.brandColour },
        hasLogo: sql<boolean>`${companies.logo} is not null`,
        profileVersion: companies.profileVersion,
        mustChangePassword: logins.mustChangePassword,
        account: { id: accounts.id, email: accounts.email, mobile: accounts.mobile, isStaff: accounts.isStaff },
      })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .leftJoin(logins, eq(logins.personId, people.id))
      .leftJoin(accounts, eq(accounts.id, people.accountId))
      .where(eq(people.id, caller.personId))
      .limit(1);
    if (!row) throw new UnauthorizedException('Please sign in');
    const current = await this.caller(caller.personId);
    return {
      person: {
        id: row.person.id,
        fullName: row.person.fullName,
        email: row.person.email,
        employeeCode: row.person.employeeCode,
        role: row.person.platformRole,
      },
      company: { ...row.company, logoUrl: CompanyService.logoUrl({ id: row.company.id, hasLogo: row.hasLogo, profileVersion: row.profileVersion }) },
      apps: (Object.keys(current.apps) as AppKey[]).map((app) => ({ app, ...APP_INFO[app] })),
      /** Admin workspace permissions (PLAN.md §19.19): owners and admins have them all. */
      permissions: [...(await platformPermissionsOf(this.dbs, caller.personId, row.person.platformRole))].sort(),
      /**
       * What their roles give them (R1): the role editor shows what they cannot give. Every app permission with each
       * scope a role gives it, the Admin permissions, and their highest role level. The owner may give everything.
       */
      held: await heldAccess(this.dbs, caller.personId, row.person.platformRole),
      /** Nothing sets it any more (R7); kept false for older clients. */
      mustChangePassword: row.mustChangePassword ?? false,
      /** The person's account (PLAN.md §21), or null for an admin-made login. */
      account: row.account?.id ? row.account : null,
      /** For banners: plan, state, trial end, read-only, days left. */
      billing: await billingSummary(this.dbs, row.person.companyId),
    };
  }

  async changePassword(caller: Caller, currentPassword: string, newPassword: string) {
    const db = this.dbs.db;
    // A stolen access token must not become a way to guess the current password (and then take the account over).
    const key = `pw:${caller.personId}`;
    if (this.throttle.blocked(key, MAX_FAILED_LOGINS)) throw new HttpException('Too many wrong passwords. Try again in a few minutes.', 429);
    const [person] = await db.select({ accountId: people.accountId }).from(people).where(eq(people.id, caller.personId)).limit(1);
    if (person?.accountId) return this.changeAccountPassword(caller, person.accountId, currentPassword, newPassword, key);
    const [login] = await db.select().from(logins).where(eq(logins.personId, caller.personId)).limit(1);
    if (!login || !(await verifyPassword(login.passwordHash, currentPassword))) {
      this.throttle.fail(key);
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    this.throttle.clear(key);
    if (currentPassword === newPassword) throw badRequest('Choose a new password', { newPassword: 'Choose a new password' });
    await db
      .update(logins)
      .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(logins.personId, caller.personId));
    await this.revokeAll(caller.personId, caller.sessionFamily);
  }

  /** An account's password (PLAN.md §21): one for all its companies; every other session of the account ends. */
  private async changeAccountPassword(caller: Caller, accountId: string, currentPassword: string, newPassword: string, key: string) {
    const db = this.dbs.db;
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    if (!account || !(await verifyPassword(account.passwordHash, currentPassword))) {
      this.throttle.fail(key);
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    this.throttle.clear(key);
    if (currentPassword === newPassword) throw badRequest('Choose a new password', { newPassword: 'Choose a new password' });
    await db.update(accounts).set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(accounts.id, accountId));
    await this.revokeAccount(accountId, caller.sessionFamily);
  }
}
