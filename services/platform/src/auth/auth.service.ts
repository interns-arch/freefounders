import { Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { badRequest, type Caller } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, logins, people, personApps, type PlatformRole, refreshSessions } from '../db/schema';
import { ACCESS_TTL_SECONDS, TokensService } from '../keys/tokens.service';

/** "Stay signed in": a refresh session lives until it goes unused this long (founder decision: 1 year). */
export const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Two tabs refreshing at once both present the same token; the slower one is not treated as theft. */
const ROTATION_GRACE_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const WRONG = 'Wrong email / username / employee ID or password';

export const APP_INFO: Record<AppKey, { name: string; path: string }> = {
  tasks: { name: 'Tasks', path: '/tasks/' },
  assets: { name: 'Assets', path: '/assets/' },
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function hashPassword(password: string): Promise<string> {
  return hash(password);
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
export class AuthService {
  // Verifying against a dummy hash keeps response time similar for unknown logins.
  private readonly dummyHash = hash(randomBytes(16).toString('hex'));

  constructor(
    private readonly dbs: DbService,
    private readonly tokens: TokensService,
  ) {}

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
    const found = await this.findLogin(input);
    const ok = await verify(found?.login.passwordHash ?? (await this.dummyHash), password).catch(() => false);

    if (!found || found.person.status !== 'active' || found.companyStatus !== 'active') throw new UnauthorizedException(WRONG);
    const { login, person } = found;
    if (login.lockedUntil && login.lockedUntil > new Date()) {
      throw new UnauthorizedException('Too many failed attempts. Try again in a few minutes.');
    }
    if (!ok) {
      const failed = login.failedLogins + 1;
      await db
        .update(logins)
        .set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : null })
        .where(eq(logins.personId, person.id));
      throw new UnauthorizedException(WRONG);
    }

    await db.update(logins).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(logins.personId, person.id));
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
      .select({ person: people, company: { id: companies.id, name: companies.name }, mustChangePassword: logins.mustChangePassword })
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
      company: row.company,
      apps: (Object.keys(current.apps) as AppKey[]).map((app) => ({ app, ...APP_INFO[app] })),
      mustChangePassword: row.mustChangePassword ?? false,
    };
  }

  async changePassword(caller: Caller, currentPassword: string, newPassword: string) {
    const db = this.dbs.db;
    const [login] = await db.select().from(logins).where(eq(logins.personId, caller.personId)).limit(1);
    if (!login || !(await verify(login.passwordHash, currentPassword).catch(() => false))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) throw badRequest('Choose a new password', { newPassword: 'Choose a new password' });
    await db
      .update(logins)
      .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(logins.personId, caller.personId));
    await this.revokeAll(caller.personId, caller.sessionFamily);
  }
}
