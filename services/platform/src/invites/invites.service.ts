import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccountsService, type AccountRow } from '../accounts/accounts.service';
import { AuthService, type Meta } from '../auth/auth.service';
import { assertNewSeat, isReadOnly, paymentRequired, READ_ONLY_MESSAGE, subscriptionOf } from '../billing/seats';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies, invites, people, personApps, roleGrants, roles } from '../db/schema';
import { PeopleService } from '../people/people.service';
import { RolesService } from '../roles/roles.service';
import { internalUrl } from '../provision/provision.client';

export const inviteSchema = z.object({
  roleIds: z.array(z.string().uuid()).max(20).default([]),
  apps: z.array(z.enum(APPS)).max(APPS.length).default([]),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  maxUses: z.number().int().min(1).max(1000).nullable().default(null),
});
export const acceptSchema = z.object({
  signupToken: z.string().min(20).max(200).optional(),
  fullName: z.string().trim().min(1, 'Enter your name').max(120).optional(),
  password: z.string().min(1).max(200).optional(),
  client: z.enum(['web', 'mobile']).default('web'),
});

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
type InviteRow = typeof invites.$inferSelect;
type Unusable = 'revoked' | 'expired' | 'used_up';
/** Why a link no longer works (null = it works). */
const unusable = (i: InviteRow): Unusable | null =>
  i.revokedAt ? 'revoked' : i.expiresAt <= new Date() ? 'expired' : i.maxUses !== null && i.uses >= i.maxUses ? 'used_up' : null;
const isValid = (i: InviteRow) => !unusable(i);
export const GONE_MESSAGES: Record<Unusable, string> = {
  expired: 'This invite link has expired. Ask the person who sent it for a new link.',
  revoked: 'This invite link was switched off by the company. Ask the person who sent it for a new link.',
  used_up: 'This invite link has already been used by as many people as it allows. Ask the person who sent it for a new link.',
};
const gone = (i: InviteRow) => new HttpException({ statusCode: 410, message: GONE_MESSAGES[unusable(i) ?? 'expired'], reason: unusable(i) ?? 'expired' }, 410);

/**
 * Invite links (PLAN.md §21.2): roles and apps chosen by someone who manages people (only what they hold, R1), an
 * expiry and a number of uses, switched off at any time. Only the sha256 of the token is stored.
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly dbs: DbService,
    private readonly auth: AuthService,
    private readonly accounts: AccountsService,
    private readonly rolesSvc: RolesService,
    private readonly peopleSvc: PeopleService,
  ) {}

  private async byToken(token: string): Promise<InviteRow | undefined> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
    const [row] = await this.dbs.db.select().from(invites).where(eq(invites.tokenHash, sha256(token))).limit(1);
    return row;
  }

  async create(caller: Caller, input: z.infer<typeof inviteSchema>, origin: string) {
    const roleRows = await this.rolesSvc.assertCanGiveRoles(caller, input.roleIds);
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
    for (const app of input.apps) if (!c?.apps.includes(app)) throw badRequest(`Your plan does not include ${app === 'tasks' ? 'Tasks' : 'Assets'}. Untick it, or change the plan in Billing.`, { apps: `Not in your plan: ${app}` });
    const token = randomBytes(32).toString('base64url');
    const [row] = await this.dbs.db
      .insert(invites)
      .values({
        companyId: caller.companyId,
        tokenHash: sha256(token),
        roleIds: roleRows.map((r) => r.id),
        apps: [...new Set(input.apps)],
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
        maxUses: input.maxUses,
        createdBy: caller.personId,
      })
      .returning({ id: invites.id });
    const base = (process.env.PUBLIC_WEB_URL?.trim() || origin).replace(/\/+$/, '');
    return { id: row.id, token, url: `${base}/join/${token}` };
  }

  async list(caller: Caller) {
    const rows = await this.dbs.db
      .select({ invite: invites, createdByName: people.fullName })
      .from(invites)
      .leftJoin(people, eq(people.id, invites.createdBy))
      .where(eq(invites.companyId, caller.companyId))
      .orderBy(desc(invites.createdAt))
      .limit(200);
    const roleIds = [...new Set(rows.flatMap((r) => r.invite.roleIds))];
    const names = roleIds.length ? await this.dbs.db.select({ id: roles.id, name: roles.name }).from(roles).where(and(inArray(roles.id, roleIds), eq(roles.companyId, caller.companyId))) : [];
    return rows.map(({ invite: i, createdByName }) => ({
      id: i.id,
      roleIds: i.roleIds,
      roles: i.roleIds.map((id) => names.find((n) => n.id === id)?.name).filter(Boolean),
      apps: i.apps,
      expiresAt: i.expiresAt,
      maxUses: i.maxUses,
      uses: i.uses,
      revoked: !!i.revokedAt,
      status: unusable(i) ?? 'active',
      createdBy: createdByName,
      createdAt: i.createdAt,
    }));
  }

  async revoke(caller: Caller, id: string) {
    const [row] = await this.dbs.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, id), eq(invites.companyId, caller.companyId), isNull(invites.revokedAt)))
      .returning({ id: invites.id });
    if (!row) {
      const [exists] = await this.dbs.db.select({ id: invites.id }).from(invites).where(and(eq(invites.id, id), eq(invites.companyId, caller.companyId))).limit(1);
      if (!exists) throw notFound('Invite');
    }
    return { ok: true };
  }

  /** GET invites/:token (public): what the joiner sees before joining. */
  async info(token: string) {
    const i = await this.byToken(token);
    if (!i) throw new NotFoundException('This invite link is not complete or does not exist. Check you copied all of it, or ask for a new link.');
    const [c] = await this.dbs.db.select({ name: companies.name }).from(companies).where(eq(companies.id, i.companyId)).limit(1);
    const names = i.roleIds.length ? await this.dbs.db.select({ name: roles.name }).from(roles).where(and(inArray(roles.id, i.roleIds), eq(roles.archived, false))) : [];
    const reason = unusable(i);
    return { companyName: c?.name ?? '', roles: names.map((n) => n.name), apps: i.apps, expiresAt: i.expiresAt, valid: !reason, ...(reason ? { reason, message: GONE_MESSAGES[reason] } : {}) };
  }

  /** The apps a person joining gets: the invite's own, and those the invite's roles reach, in the company's plan. */
  private async appsFor(i: InviteRow): Promise<AppKey[]> {
    const [c] = await this.dbs.db.select({ apps: companies.enabledApps }).from(companies).where(eq(companies.id, i.companyId)).limit(1);
    const fromRoles = i.roleIds.length ? await this.dbs.db.selectDistinct({ app: roleGrants.app }).from(roleGrants).where(inArray(roleGrants.roleId, i.roleIds)) : [];
    const all = new Set<string>([...i.apps, ...fromRoles.map((r) => r.app)]);
    return [...all].filter((a): a is AppKey => (APPS as readonly string[]).includes(a) && !!c?.apps.includes(a) && !!internalUrl(a as AppKey));
  }

  /**
   * POST invites/:token/accept: a signed-in account joins, or a new account is made from a sign-up token (or an existing
   * account proves its password). Already a member: just signed in there. A seat must be free (402).
   */
  async accept(token: string, caller: Caller | undefined, body: z.infer<typeof acceptSchema>, meta: Meta) {
    const invite = await this.byToken(token);
    if (!invite) throw new NotFoundException('This invite link is not complete or does not exist. Check you copied all of it, or ask for a new link.');
    if (!isValid(invite)) throw gone(invite);

    let account: AccountRow | undefined;
    let checked: Awaited<ReturnType<AccountsService['checkSignup']>> | undefined;
    if (body.signupToken) {
      if (!body.password) throw badRequest('Enter your password', { password: 'Required' });
      checked = await this.accounts.checkSignup(body.signupToken, body.password, meta.ip, body.fullName);
      account = checked.existing;
    } else {
      if (!caller) throw new HttpException({ statusCode: 401, message: 'Please sign in' }, 401);
      account = await this.accounts.accountOfPerson(caller.personId);
      if (!account) throw new ForbiddenException('Sign in with your account (email or mobile number) to join, or sign up.');
    }

    // Already in this company: sign in there (nothing is used up).
    if (account) {
      const [member] = await this.dbs.db.select().from(people).where(and(eq(people.companyId, invite.companyId), eq(people.accountId, account.id))).limit(1);
      if (member) {
        if (checked && body.signupToken) await this.dbs.tx(() => this.accounts.takeSignup(body.signupToken!, checked!, '', ''));
        if (member.status !== 'active') throw new ForbiddenException('Your access to this company was switched off. Ask its admin.');
        return { ...(await this.auth.issueFor(member.id, meta)), companyId: invite.companyId, mustChangePassword: false };
      }
    }

    const { sub } = await subscriptionOf(this.dbs, invite.companyId);
    if (isReadOnly(sub.state)) throw paymentRequired(READ_ONLY_MESSAGE);
    const apps = await this.appsFor(invite);
    if (apps.length) await assertNewSeat(this.dbs, invite.companyId);

    const personId = await this.dbs.tx(async (tx) => {
      const [locked] = await tx.select().from(invites).where(eq(invites.id, invite.id)).for('update').limit(1);
      if (!locked || !isValid(locked)) throw gone(locked ?? invite);
      if (!account) account = await this.accounts.takeSignup(body.signupToken!, checked!, body.fullName!, body.password!);
      else if (checked) await this.accounts.takeSignup(body.signupToken!, checked, '', '');
      await tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.id, invite.id));
      // Someone the admin already added with this email (no account yet) becomes this account's membership.
      if (account.email) {
        const [same] = await tx.select().from(people).where(and(eq(people.companyId, invite.companyId), sql`lower(${people.email}) = ${account.email.toLowerCase()}`)).limit(1);
        if (same) {
          if (same.accountId && same.accountId !== account.id) throw new ConflictException('Another account already uses this email in this company');
          await tx.update(people).set({ accountId: account.id, status: 'active', updatedAt: new Date() }).where(eq(people.id, same.id));
          return same.id;
        }
      }
      const [p] = await tx
        .insert(people)
        .values({ companyId: invite.companyId, fullName: account.fullName, email: account.email, mobile: account.mobile, platformRole: 'member', accountId: account.id })
        .returning({ id: people.id });
      return p.id;
    });

    // Roles and apps through the same services as when an admin adds a person (provisioned into Tasks/Assets).
    await this.rolesSvc.giveRolesFromInvite(invite.companyId, personId, invite.roleIds);
    const [person] = await this.dbs.db.select().from(people).where(eq(people.id, personId)).limit(1);
    const held = (await this.dbs.db.select({ app: personApps.app }).from(personApps).where(eq(personApps.personId, personId))).map((r) => r.app);
    for (const app of invite.apps.filter((a): a is AppKey => apps.includes(a as AppKey) && !held.includes(a))) {
      await this.peopleSvc.giveApp(invite.companyId, person, app);
    }
    return { ...(await this.auth.issueFor(personId, meta)), companyId: invite.companyId, mustChangePassword: false };
  }
}
