import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, sql } from 'drizzle-orm';
import { type AuthedRequest, IS_PUBLIC, NEEDS } from '../common/http';
import { DbService } from '../db/db.service';
import { companies, people, refreshSessions } from '../db/schema';
import { TokensService } from '../keys/tokens.service';
import { type PlatformPermission, platformPermissionsOf } from '../roles/platform-permissions';

/**
 * Global guard: verifies `Authorization: Bearer <access token>`. On every signed-in route it also checks, in one indexed
 * query, that the person and company are still active and that the token's sign-in session (`fam`) has not been ended:
 * signing out, "sign out everywhere", a password change or reset, switching someone off or deleting them all count on
 * the Platform at once (the apps still accept the token until it expires, at most 15 minutes). Admin routes also
 * re-check the person's permissions in the database.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly dbs: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.caller = (await this.tokens.verifyAccess(header.slice(7).trim())) ?? undefined;
    }

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const caller = req.caller;
    if (!caller?.sessionFamily) throw new UnauthorizedException('Please sign in');

    const [me] = await this.dbs.db
      .select({
        role: people.platformRole,
        status: people.status,
        companyStatus: companies.status,
        live: sql<boolean>`exists (select 1 from ${refreshSessions} where ${refreshSessions.familyId} = ${caller.sessionFamily}
          and ${refreshSessions.personId} = ${people.id} and ${refreshSessions.revokedAt} is null and ${refreshSessions.expiresAt} > now())`,
      })
      .from(people)
      .innerJoin(companies, eq(companies.id, people.companyId))
      .where(and(eq(people.id, caller.personId), eq(people.companyId, caller.companyId)))
      .limit(1);
    if (!me || me.status !== 'active' || me.companyStatus !== 'active' || !me.live) throw new UnauthorizedException('Please sign in');
    // Tokens live 15 minutes; a demoted or re-roled person must lose access at once.
    caller.role = me.role as typeof caller.role;

    const needs = this.reflector.getAllAndOverride<PlatformPermission[] | undefined>(NEEDS, targets);
    if (needs) {
      caller.permissions = await platformPermissionsOf(this.dbs, caller.personId, me.role);
      if (!needs.some((p) => caller.permissions!.has(p))) throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
