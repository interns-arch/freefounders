import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { ADMIN_ONLY, type AuthedRequest, IS_PUBLIC } from '../common/http';
import { DbService } from '../db/db.service';
import { people } from '../db/schema';
import { TokensService } from '../keys/tokens.service';

/** Global guard: verifies `Authorization: Bearer <access token>`; admin routes re-check the role in the database. */
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
    if (!req.caller) throw new UnauthorizedException('Please sign in');

    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets)) {
      // Tokens live 15 minutes; a demoted or deactivated admin must lose access at once.
      const [me] = await this.dbs.db
        .select({ role: people.platformRole, status: people.status })
        .from(people)
        .where(eq(people.id, req.caller.personId))
        .limit(1);
      if (!me || me.status !== 'active' || (me.role !== 'owner' && me.role !== 'admin')) {
        throw new ForbiddenException('You do not have permission to do this');
      }
      req.caller.role = me.role;
    }
    return true;
  }
}
