import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@eam/shared';
import { type AuthedRequest, IS_PUBLIC, PERMISSIONS_KEY } from '../../common/http';
import { AuthService, SESSION_COOKIE } from './auth.service';

/** Global guard: resolves the session cookie into an Actor and enforces @RequirePermissions. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 20) {
      const session = await this.auth.resolve(token);
      if (session) {
        req.actor = session.actor;
        req.sessionId = session.id;
      }
    }

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!req.actor) throw new UnauthorizedException('Please sign in');

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (required?.length && !required.some((p) => req.actor!.permissions.has(p))) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
