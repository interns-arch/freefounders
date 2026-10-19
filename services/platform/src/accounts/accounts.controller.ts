import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { respondTokens } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { type AuthedRequest, type Caller, CurrentCaller, Needs, Public, ReadOnlyOk, uuidParam, ZodPipe } from '../common/http';
import { acceptSchema, inviteSchema, InvitesService } from '../invites/invites.service';
import { AccountsService, companySchema, completeSchema, forgotSchema, resetSchema, resetVerifySchema, startSchema, verifySchema } from './accounts.service';

const newCompanySchema = companySchema.extend({ client: z.enum(['web', 'mobile']).default('web') });
const meta = (req: AuthedRequest, client: 'web' | 'mobile' = 'web') => ({ ip: req.ip, userAgent: req.headers['user-agent'], client });

/** Self-serve sign-up, forgot password and new companies (PLAN.md §21.2). */
@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Public()
  @Post('signup/start')
  @HttpCode(200)
  start(@Body(new ZodPipe(startSchema)) body: z.infer<typeof startSchema>, @Req() req: AuthedRequest) {
    return this.accounts.signupStart(body.identifier, req.ip);
  }

  @Public()
  @Post('signup/verify')
  @HttpCode(200)
  verify(@Body(new ZodPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.accounts.signupVerify(body.otpId, body.code);
  }

  @Public()
  @Post('signup/complete')
  @HttpCode(200)
  async complete(@Body(new ZodPipe(completeSchema)) body: z.infer<typeof completeSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const out = await this.accounts.signupComplete(body, meta(req, body.client));
    return { ...respondTokens(res, out, body.client), mustChangePassword: false, companyId: out.companyId, provisionMs: out.provisionMs, setupIncomplete: out.setupIncomplete };
  }

  @Public()
  @Post('auth/forgot')
  @HttpCode(200)
  forgot(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Req() req: AuthedRequest) {
    return this.accounts.forgot(body.identifier, req.ip);
  }

  /** Checks a reset code before the new password is asked for (the code stays usable for auth/reset). */
  @Public()
  @Post('auth/reset/verify')
  @HttpCode(200)
  resetVerify(@Body(new ZodPipe(resetVerifySchema)) body: z.infer<typeof resetVerifySchema>) {
    return this.accounts.resetVerify(body.otpId, body.code);
  }

  @Public()
  @Post('auth/reset')
  @HttpCode(200)
  reset(@Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>) {
    return this.accounts.reset(body.otpId, body.code, body.newPassword);
  }

  /** A new company for the signed-in account (works while the current one is read-only). */
  @ReadOnlyOk()
  @Post('companies')
  @HttpCode(200)
  async createCompany(@CurrentCaller() caller: Caller, @Body(new ZodPipe(newCompanySchema)) body: z.infer<typeof newCompanySchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const { client, ...input } = body;
    const out = await this.accounts.createCompany(caller, input, meta(req, client));
    return { ...respondTokens(res, out, client), mustChangePassword: false, companyId: out.companyId, provisionMs: out.provisionMs, setupIncomplete: out.setupIncomplete };
  }
}

/** Invite links (PLAN.md §21.2): managed by people with Manage people; opened and accepted by the joiner. */
@Controller('invites')
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly auth: AuthService,
  ) {}

  @Needs('people.manage')
  @Get()
  list(@CurrentCaller() caller: Caller) {
    return this.invites.list(caller);
  }

  @Needs('people.manage')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>, @Req() req: AuthedRequest) {
    const origin = typeof req.headers.origin === 'string' && /^https?:\/\/[^/]+$/.test(req.headers.origin) ? req.headers.origin : `${req.protocol}://${req.get('host')}`;
    return this.invites.create(caller, body, origin);
  }

  @Needs('people.manage')
  @Delete(':id')
  @HttpCode(200)
  revoke(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.invites.revoke(caller, uuidParam(id));
  }

  @Public()
  @Get(':token')
  info(@Param('token') token: string) {
    return this.invites.info(token);
  }

  /** Signed in (Bearer token) or `{signupToken, fullName, password}`. Public route: the session is checked here. */
  @Public()
  @Post(':token/accept')
  @HttpCode(200)
  async accept(@Param('token') token: string, @Body(new ZodPipe(acceptSchema)) body: z.infer<typeof acceptSchema>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const caller = !body.signupToken && req.caller && (await this.auth.isLive(req.caller)) ? req.caller : undefined;
    const out = await this.invites.accept(token, caller, body, meta(req, body.client));
    return { ...respondTokens(res, out, body.client), mustChangePassword: false, companyId: out.companyId };
  }
}
