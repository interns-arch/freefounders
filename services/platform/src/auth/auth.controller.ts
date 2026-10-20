import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { type AuthedRequest, type Caller, CurrentCaller, Public, ReadOnlyOk, ZodPipe } from '../common/http';
import { KeysService } from '../keys/keys.service';
import { AuthService, type Issued, REFRESH_TTL_MS } from './auth.service';

export const REFRESH_COOKIE = 'ff_refresh';
/** The cookie is only ever sent to the Platform's own auth endpoints. */
const COOKIE_PATH = '/api/platform/auth';

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Enter your email, mobile number, username or employee ID').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
  client: z.enum(['web', 'mobile']).default('web'),
});
/** Second step of an account sign-in with several companies (PLAN.md §21.2). */
const ticketSchema = z.object({
  ticket: z.string().min(20).max(200),
  companyId: z.string().uuid('Choose a company'),
  client: z.enum(['web', 'mobile']).default('web'),
});
const switchSchema = z.object({ companyId: z.string().uuid('Choose a company'), client: z.enum(['web', 'mobile']).default('web') });
const refreshSchema = z.object({ refreshToken: z.string().max(200).optional() });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(6, 'Use at least 6 characters').max(200),
});

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: COOKIE_PATH,
  };
}

/** Web gets the refresh token as an httpOnly cookie; mobile gets it in the body for secure storage. */
export function respondTokens(res: Response, issued: Issued, client: 'web' | 'mobile') {
  if (client === 'web' && issued.refreshToken) {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, { ...cookieOptions(), maxAge: REFRESH_TTL_MS });
  }
  return {
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
    ...(client === 'mobile' ? { refreshToken: issued.refreshToken } : {}),
  };
}

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly keys: KeysService,
  ) {}

  private respond(res: Response, issued: Issued, client: 'web' | 'mobile') {
    return respondTokens(res, issued, client);
  }

  /**
   * `{login, password}`: username, email or employee ID of an admin-made login, or an account's email / mobile. An
   * account in several companies gets `{chooseCompany, ticket}`, then sends `{ticket, companyId}` (PLAN.md §21.2).
   */
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() raw: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const meta = (client: 'web' | 'mobile') => ({ ip: req.ip, userAgent: req.headers['user-agent'], client });
    if (raw && typeof raw === 'object' && 'ticket' in raw) {
      const body = new ZodPipe(ticketSchema).transform(raw);
      const issued = await this.auth.loginWithTicket(body.ticket, body.companyId, meta(body.client));
      return { ...this.respond(res, issued, body.client), mustChangePassword: false };
    }
    const body = new ZodPipe(loginSchema).transform(raw);
    const result = await this.auth.login(body.login, body.password, meta(body.client));
    if ('chooseCompany' in result) return result;
    return { ...this.respond(res, result, body.client), mustChangePassword: result.mustChangePassword };
  }

  /** The companies of the caller's account (just the current one for an admin-made login). */
  @Get('auth/companies')
  companies(@CurrentCaller() caller: Caller) {
    return this.auth.companiesOf(caller);
  }

  /** Company switcher: tokens for the same account in another company; this session ends. */
  @ReadOnlyOk()
  @Post('auth/switch')
  @HttpCode(200)
  async switch(@CurrentCaller() caller: Caller, @Body(new ZodPipe(switchSchema)) body: z.infer<typeof switchSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const issued = await this.auth.switchCompany(caller, body.companyId, { ip: req.ip, userAgent: req.headers['user-agent'], client: body.client });
    return { ...this.respond(res, issued, body.client), mustChangePassword: false };
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

  /** "Sign out everywhere": ends every session of the caller, this one included (e.g. after losing a phone). */
  @ReadOnlyOk()
  @Post('auth/logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentCaller() caller: Caller, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAll(caller.personId);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    return { ok: true };
  }

  @Get('auth/me')
  me(@CurrentCaller() caller: Caller) {
    return this.auth.me(caller);
  }

  @ReadOnlyOk()
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

  /**
   * The phone app's update prompt (PLAN.md §19.30, original app 0980b4d): an installed app older than `minVersion` asks
   * once per session to update, and "Update now" opens `apkUrl` in the phone's browser. MOBILE_MIN_VERSION (default
   * 1.1.0, the first app with voice) and MOBILE_APK_URL (default /download/freefounders.apk, served by the web app from
   * apps/web/public/download/; a full https:// address works too). An empty MOBILE_MIN_VERSION turns the prompt off.
   */
  @Public()
  @Get('app-version')
  appVersion() {
    return {
      minVersion: (process.env.MOBILE_MIN_VERSION ?? '1.1.0').trim() || null,
      apkUrl: (process.env.MOBILE_APK_URL ?? '').trim() || '/download/freefounders.apk',
    };
  }
}
