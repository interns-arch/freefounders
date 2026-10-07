import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthedRequest, type Caller, CurrentCaller, Public, ZodPipe } from '../common/http';
import { KeysService } from '../keys/keys.service';
import { AuthService, type Issued, REFRESH_TTL_MS } from './auth.service';

export const REFRESH_COOKIE = 'ff_refresh';
/** The cookie is only ever sent to the Platform's own auth endpoints. */
const COOKIE_PATH = '/api/platform/auth';

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Enter your email, username or employee ID').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
  client: z.enum(['web', 'mobile']).default('web'),
});
const refreshSchema = z.object({ refreshToken: z.string().max(200).optional() });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
});

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: COOKIE_PATH,
  };
}

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly keys: KeysService,
  ) {}

  /** Web gets the refresh token as an httpOnly cookie; mobile gets it in the body for secure storage. */
  private respond(res: Response, issued: Issued, client: 'web' | 'mobile') {
    if (client === 'web' && issued.refreshToken) {
      res.cookie(REFRESH_COOKIE, issued.refreshToken, { ...cookieOptions(), maxAge: REFRESH_TTL_MS });
    }
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      ...(client === 'mobile' ? { refreshToken: issued.refreshToken } : {}),
    };
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const issued = await this.auth.login(body.login, body.password, { ip: req.ip, userAgent: req.headers['user-agent'], client: body.client });
    return { ...this.respond(res, issued, body.client), mustChangePassword: issued.mustChangePassword };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const client = body.refreshToken ? 'mobile' : 'web';
    const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    try {
      const issued = await this.auth.refresh(token, { ip: req.ip, userAgent: req.headers['user-agent'] });
      return this.respond(res, issued, client);
    } catch (err) {
      if (client === 'web') res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(body.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    return { ok: true };
  }

  @Get('auth/me')
  me(@CurrentCaller() caller: Caller) {
    return this.auth.me(caller);
  }

  @Post('auth/change-password')
  @HttpCode(200)
  async changePassword(@CurrentCaller() caller: Caller, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(caller, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  /** Public keys Tasks and Assets use to verify access tokens. */
  @Public()
  @Get('.well-known/jwks.json')
  jwks() {
    return this.keys.jwks();
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'platform' };
  }
}
