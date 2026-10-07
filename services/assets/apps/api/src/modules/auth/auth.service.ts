import { Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Permission } from '@eam/shared';
import type { Actor } from '../../common/actor';
import { badRequest } from '../../common/http';
import { CredentialVault } from '../../core/credential-vault.service';
import { DbService } from '../../db/db.service';
import { employees, roles, sessions, users } from '../../db/schema';
import { ACCESS_AUDIENCE, verifyPlatformToken } from './platform-token';

export const SESSION_COOKIE = 'eam_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
/** Upper bound for a session made from a Platform token (Platform access tokens live 15 minutes). */
const PLATFORM_SESSION_MAX_MS = 15 * 60 * 1000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export interface ResolvedSession {
  id: string;
  actor: Actor;
}

@Injectable()
export class AuthService {
  // Verifying against a dummy hash keeps response time similar for unknown emails.
  private readonly dummyHash = hash(randomBytes(16).toString('hex'));

  constructor(
    private readonly dbs: DbService,
    private readonly vault: CredentialVault,
  ) {}

  /** Columns to write whenever a password is set: the hash for sign-in and an encrypted copy admins can view. */
  async passwordFields(password: string, setByName: string) {
    return {
      passwordHash: await hashPassword(password),
      passwordSaved: await this.vault.seal(password),
      passwordSavedAt: new Date(),
      passwordSavedByName: setByName,
    };
  }

  /** Finds the account for an email address, or for an employee code such as CT000099. */
  private async findLogin(login: string) {
    const db = this.dbs.db;
    const id = login.trim();
    if (id.includes('@')) {
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${id})`).limit(1);
      return user;
    }
    const [named] = await db.select().from(users).where(sql`lower(${users.username}) = lower(${id})`).limit(1);
    if (named) return named;
    const [row] = await db
      .select({ user: users })
      .from(users)
      .innerJoin(employees, eq(employees.id, users.employeeId))
      .where(sql`lower(${employees.employeeCode}) = lower(${id})`)
      .limit(1);
    return row?.user;
  }

  /** A login ID or email may belong to one login only, and a login ID may not be someone else's employee ID. */
  async assertLoginFree(input: { username?: string | null; email?: string | null }, self: { userId?: string | null; employeeId?: string | null }) {
    const db = this.dbs.db;
    const errors: Record<string, string> = {};
    if (input.username) {
      const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${input.username}) and ${users.id} is distinct from ${self.userId ?? null}`);
      const [emp] = await db.select({ id: employees.id }).from(employees).where(sql`lower(${employees.employeeCode}) = lower(${input.username}) and ${employees.id} is distinct from ${self.employeeId ?? null}`);
      if (user) errors.username = 'This login ID is already taken';
      else if (emp) errors.username = 'This is another employee’s ID — choose a different login ID';
    }
    if (input.email) {
      const [user] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${input.email}) and ${users.id} is distinct from ${self.userId ?? null}`);
      if (user) errors.email = 'Another login already uses this email';
    }
    const first = Object.values(errors)[0];
    if (first) throw badRequest(first, errors);
  }

  async login(login: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const db = this.dbs.db;
    const user = await this.findLogin(login);
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), password).catch(() => false);

    if (!user || !user.isActive) throw new UnauthorizedException('Wrong email / employee ID or password');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Too many failed attempts. Try again in a few minutes.');
    }
    if (!ok) {
      const failed = user.failedLogins + 1;
      await db
        .update(users)
        .set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : null })
        .where(eq(users.id, user.id));
      throw new UnauthorizedException('Wrong email / employee ID or password');
    }

    await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const token = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      id: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    return { token };
  }

  async logout(sessionId: string | undefined) {
    if (sessionId) await this.dbs.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /** Validates a session cookie and builds the Actor. Renews the session when it is in use. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const id = sha256(token);
    const db = this.dbs.db;
    const [row] = await db
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        fixedExpiry: sessions.fixedExpiry,
        userId: users.id,
        name: users.name,
        email: users.email,
        employeeId: users.employeeId,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(users.isActive, true)))
      .limit(1);
    if (!row) return null;

    if (!row.fixedExpiry && Date.now() - row.lastSeenAt.getTime() > RENEW_AFTER_MS) {
      await db
        .update(sessions)
        .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
        .where(eq(sessions.id, id));
    }
    return {
      id,
      actor: {
        userId: row.userId,
        name: row.name,
        email: row.email,
        employeeId: row.employeeId,
        roleName: row.roleName,
        permissions: new Set(row.permissions as Permission[]),
      },
    };
  }

  /**
   * Builds the Actor from a FreeFounders Platform access token. The token names this app's user id
   * (`apps.assets`); that user must be linked to the token's person and still active. Permissions come
   * from the user's role here, exactly as for a cookie session.
   */
  async resolvePlatformToken(token: string): Promise<Actor | null> {
    return (await this.platformUser(token))?.actor ?? null;
  }

  private async platformUser(token: string): Promise<{ actor: Actor; expiresAt: Date } | null> {
    const claims = await verifyPlatformToken(token, ACCESS_AUDIENCE);
    const localId = (claims?.apps as Record<string, unknown> | undefined)?.assets;
    if (!claims || typeof localId !== 'string' || !/^[0-9a-f-]{36}$/i.test(localId) || !/^[0-9a-f-]{36}$/i.test(String(claims.sub))) return null;
    const [row] = await this.dbs.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        employeeId: users.employeeId,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, localId), eq(users.platformPersonId, String(claims.sub)), eq(users.isActive, true)))
      .limit(1);
    if (!row) return null;
    return { actor: { ...row, permissions: new Set(row.permissions as Permission[]) }, expiresAt: new Date((claims.exp ?? 0) * 1000) };
  }

  /**
   * Exchanges a Platform access token for an ordinary session cookie, so the web app (photos, downloads,
   * everything) works unchanged. The session ends when the token would have and is never extended: the
   * web app exchanges a fresh token, and once the Platform session is gone (sign-out, deactivation) so is this.
   */
  async platformSession(token: string, meta: { ip?: string; userAgent?: string }) {
    const found = await this.platformUser(token);
    if (!found) throw new UnauthorizedException('Please sign in');
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Math.min(found.expiresAt.getTime(), Date.now() + PLATFORM_SESSION_MAX_MS));
    await this.dbs.db.insert(sessions).values({
      id: sha256(sessionToken),
      userId: found.actor.userId!,
      expiresAt,
      fixedExpiry: true,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    await this.dbs.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, found.actor.userId!));
    return { token: sessionToken, expiresAt };
  }

  async me(actor: Actor) {
    const db = this.dbs.db;
    const [user] = await db
      .select({ id: users.id, name: users.name, email: users.email, roleId: users.roleId, roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, actor.userId!))
      .limit(1);
    const employee = actor.employeeId
      ? (
          await db
            .select({
              id: employees.id,
              fullName: employees.fullName,
              employeeCode: employees.employeeCode,
              status: employees.status,
              designation: employees.designation,
            })
            .from(employees)
            .where(eq(employees.id, actor.employeeId))
            .limit(1)
        )[0] ?? null
      : null;
    return {
      user: { id: user.id, name: user.name, email: user.email },
      role: { id: user.roleId, name: user.roleName },
      permissions: [...actor.permissions],
      employee,
    };
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string, keepSessionId?: string) {
    const db = this.dbs.db;
    const [user] = await db.select().from(users).where(eq(users.id, actor.userId!)).limit(1);
    if (!user || !(await verify(user.passwordHash, currentPassword).catch(() => false))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    await db.update(users).set({ ...(await this.passwordFields(newPassword, actor.name)), updatedAt: new Date() }).where(eq(users.id, user.id));
    // Sign out other devices.
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), keepSessionId ? sql`${sessions.id} <> ${keepSessionId}` : undefined));
  }

  async revokeUserSessions(userId: string) {
    await this.dbs.db.delete(sessions).where(eq(sessions.userId, userId));
  }
}
