import { HttpException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, pbkdf2, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { badRequest, type Caller } from '../common/http';
import { CompanyService } from '../company/company.service';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, logins, people, personApps, type PlatformRole, refreshSessions } from '../db/schema';
import { platformPermissionsOf } from '../roles/platform-permissions';
import { ACCESS_TTL_SECONDS, TokensService } from '../keys/tokens.service';
import { ipLimit, NAME_LIMIT, Throttle } from './throttle';

/** "Stay signed in": a refresh session lives until it goes unused this long (founder decision: 1 year). */
export const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Two tabs refreshing at once both present the same token; the slower one is not treated as theft. */
const ROTATION_GRACE_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
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
      if (n < 5000) return removed;
    }
  }

  /** Email, then username, then employee ID. An employee ID shared by two companies is ambiguous and not accepted. */
  private async findLogin(input: string) {
    const db = this.dbs.db;
    const id = input.trim();
    const cols = { person: people, login: logins, companyStatus: companies.status };
    const base = () => db.select(cols).from(logins).innerJoin(people, eq(people.id, logins.personId)).innerJoin(companies, eq(companies.id, people.companyId));
    if (id.includes('@')) return (await base().where(sql`lower(${people.email}) = lower(${id})`).limit(1))[0];
    const [named] = await base().where(sql`lower(${logins.username}) = lower(${id})`).limit(1);
    if (named) return named;
    const coded = await base().where(sql`lower(${people.employeeCode}) = lower(${id})`).limit(2);
    return coded.length === 1 ? coded[0] : undefined;
  }

  async login(input: string, password: string, meta: Meta): Promise<Issued & { mustChangePassword: boolean }> {
    const db = this.dbs.db;
    const ipKey = `ip:${meta.ip ?? 'unknown'}`;
    if (this.throttle.blocked(ipKey, ipLimit())) {
      throw new HttpException('Too many sign-in attempts from your network. Try again in a few minutes.', 429);
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
    const familyId = randomUUID();
    const refreshToken = await this.newRefresh(person.id, familyId, meta);
    const accessToken = await this.tokens.signAccess(await this.caller(person.id, familyId));
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, mustChangePassword: login.mustChangePassword };
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
      .select({ person: people, enabledApps: companies.enabledApps })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
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
    };
  }

  async refresh(token: string | undefined, meta: Meta): Promise<Issued> {
    if (!token || token.length < 20) throw new UnauthorizedException('Please sign in');
    const db = this.dbs.db;
    const id = sha256(token);
    const [session] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, id)).limit(1);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Please sign in');

    const [state] = await db
      .select({ status: people.status, companyStatus: companies.status, hasLogin: logins.personId })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .leftJoin(logins, eq(logins.personId, people.id))
      .where(eq(people.id, session.personId))
      .limit(1);
    if (!state || state.status !== 'active' || state.companyStatus !== 'active' || !state.hasLogin) {
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
      })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .leftJoin(logins, eq(logins.personId, people.id))
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
      mustChangePassword: row.mustChangePassword ?? false,
    };
  }

  async changePassword(caller: Caller, currentPassword: string, newPassword: string) {
    const db = this.dbs.db;
    // A stolen access token must not become a way to guess the current password (and then take the account over).
    const key = `pw:${caller.personId}`;
    if (this.throttle.blocked(key, MAX_FAILED_LOGINS)) throw new HttpException('Too many wrong passwords. Try again in a few minutes.', 429);
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
}
