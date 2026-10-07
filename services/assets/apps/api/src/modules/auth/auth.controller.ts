import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { changePasswordSchema, loginSchema, type LoginInput } from '@eam/shared';
import type { Actor } from '../../common/actor';
import { type AuthedRequest, CurrentActor, Public, ZodPipe } from '../../common/http';
import { AuthService, SESSION_COOKIE, SESSION_TTL_MS } from './auth.service';
import { bearerToken, platformEnabled } from './platform-token';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token } = await this.auth.login(body.login, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    return { ok: true };
  }

  /** FreeFounders single login: `Authorization: Bearer <platform token>` in, short session cookie out. */
  @Public()
  @Post('platform-session')
  @HttpCode(200)
  async platformSession(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const bearer = bearerToken(req.headers.authorization);
    if (!bearer || !platformEnabled()) throw new UnauthorizedException('Please sign in');
    const { token, expiresAt } = await this.auth.platformSession(bearer, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
      expires: expiresAt,
      path: '/',
    });
    return { ok: true, expiresAt };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentActor() actor: Actor,
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
  ) {
    await this.auth.changePassword(actor, body.currentPassword, body.newPassword, req.sessionId);
    return { ok: true };
  }
}
