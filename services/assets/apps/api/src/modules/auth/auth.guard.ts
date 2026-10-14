import { type CanActivate, type ExecutionContext, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@eam/shared';
import { parseSessionCookie } from '../../common/company.middleware';
import { type AuthedRequest, IS_PUBLIC, PERMISSIONS_KEY } from '../../common/http';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { bearerToken, platformEnabled } from './platform-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const READ_ONLY_MESSAGE = "Your company's subscription is read-only. The owner can renew it in Billing.";

/** Global guard: resolves the session cookie into an Actor and enforces @RequirePermissions. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookie = req.cookies?.[SESSION_COOKIE];
    // Multi-company mode prefixes the company (`<companyId>~<token>`); the middleware already picked its schema.
    const token = typeof cookie === 'string' ? parseSessionCookie(cookie).token : undefined;
    if (typeof token === 'string' && token.length > 20) {
      const session = await this.auth.resolve(token);
      if (session) {
        req.actor = session.actor;
        req.sessionId = session.id;
      }
    }
    // FreeFounders Platform sign-in: `Authorization: Bearer <platform token>` (cookie sessions still work).
    if (!req.actor) {
      const bearer = bearerToken(req.headers.authorization);
      if (bearer && platformEnabled()) req.actor = (await this.auth.resolvePlatformToken(bearer)) ?? undefined;
    }

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!req.actor) throw new UnauthorizedException('Please sign in');
    // FreeFounders Platform: a read-only subscription (token claim `ro`, carried into the session) can look, not change.
    if (req.actor.readOnly && !SAFE_METHODS.has(req.method)) {
      throw new HttpException({ statusCode: 402, message: READ_ONLY_MESSAGE }, 402);
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (required?.length && !required.some((p) => req.actor!.permissions.has(p))) {
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }
}
