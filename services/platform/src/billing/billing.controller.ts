import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { exportFile, exportFormat } from '../common/export';
import { type Caller, CurrentCaller, Needs, Public, ReadOnlyOk, uuidParam, ZodPipe } from '../common/http';
import {
  advanceSchema,
  auditQuerySchema,
  BillingService,
  checkoutSchema,
  outcomeSchema,
  profileSchema,
  razorpayVerifySchema,
  renewSchema,
  seatsSchema,
} from './billing.service';
import { invoicePdf } from './invoice-pdf';

const statusSchema = z.object({ status: z.enum(['active', 'suspended']) });
const trialSchema = z.object({ days: z.number().int().min(1).max(365) });
const planSchema = z.object({ plan: z.string().trim().min(1).max(40), seats: z.number().int().min(0).max(10_000).default(0) });

/**
 * Billing (PLAN.md §21.2): the owner, or anyone with the "Manage billing" Admin permission. Every route works while
 * the company is read-only or suspended, so the owner can pay.
 */
@ReadOnlyOk()
@Needs('billing.manage')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  view(@CurrentCaller() caller: Caller) {
    return this.billing.view(caller.companyId);
  }

  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @Put('profile')
  profile(@CurrentCaller() caller: Caller, @Body(new ZodPipe(profileSchema)) body: z.infer<typeof profileSchema>) {
    return this.billing.setProfile(caller.companyId, body);
  }

  @Post('checkout')
  @HttpCode(200)
  checkout(@CurrentCaller() caller: Caller, @Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    return this.billing.checkout(caller, body);
  }

  @Get('checkout/:id')
  getCheckout(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.billing.getCheckout(caller.companyId, uuidParam(id));
  }

  /** FakePay · test mode: Pay / Fail / Cancel. */
  @Post('fake/:id/complete')
  @HttpCode(200)
  fakeComplete(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(outcomeSchema)) body: z.infer<typeof outcomeSchema>) {
    return this.billing.fakeComplete(caller.companyId, uuidParam(id), body.outcome);
  }

  /** Razorpay Checkout's success handler (browser): signature checked, then the checkout is paid (idempotent with the webhook). */
  @Post('razorpay/verify')
  @HttpCode(200)
  razorpayVerify(@CurrentCaller() caller: Caller, @Body(new ZodPipe(razorpayVerifySchema)) body: z.infer<typeof razorpayVerifySchema>) {
    return this.billing.verifyRazorpay(caller.companyId, body);
  }

  /**
   * Razorpay Checkout in redirect mode (the phone app): Razorpay's page posts the handler fields here as a form. No
   * token or CSRF header can come with it (main.ts); the HMAC signature is the proof. Answers with the payment page.
   */
  @Public()
  @Post('razorpay/callback')
  async razorpayCallback(@Query('session') session: unknown, @Body() form: Record<string, unknown>, @Res() res: Response) {
    res.redirect(303, await this.billing.razorpayCallback(session, form));
  }

  /** Gateway webhooks: no session, no CSRF header (main.ts); the signature over the raw body is checked instead. */
  @Public()
  @Post('webhook/:gateway')
  @HttpCode(200)
  webhook(@Param('gateway') gateway: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.billing.handleWebhook(gateway, req.headers, req.rawBody);
  }

  @Post('seats')
  @HttpCode(200)
  seats(@CurrentCaller() caller: Caller, @Body(new ZodPipe(seatsSchema)) body: z.infer<typeof seatsSchema>) {
    return this.billing.changeSeats(caller.companyId, body.seats);
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(@CurrentCaller() caller: Caller) {
    return this.billing.cancel(caller.companyId);
  }

  /** The Free plan without payment, when the company fits it (now, or at the end of a paid period). */
  @Post('free')
  @HttpCode(200)
  free(@CurrentCaller() caller: Caller) {
    return this.billing.switchToFree(caller.companyId);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentCaller() caller: Caller) {
    return this.billing.resume(caller.companyId);
  }

  @Get('invoices')
  async invoices(@CurrentCaller() caller: Caller, @Query('export') exp?: string) {
    // ?export=xlsx|csv: every invoice of the company as a file (PLAN.md §19.31)
    const format = exportFormat(exp);
    if (format) {
      const { header, rows } = await this.billing.invoicesSheet(caller.companyId);
      return exportFile(format, 'invoices', header, rows);
    }
    return this.billing.invoices(caller.companyId);
  }

  @Get('invoices/:id')
  invoice(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.billing.invoice(caller.companyId, uuidParam(id));
  }

  /** The tax invoice as a PDF: the same check as the invoice itself (this company's only, billing.manage). */
  @Get('invoices/:id/pdf')
  async invoicePdf(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    const inv = await this.billing.invoice(caller.companyId, uuidParam(id));
    const name = `invoice-${inv.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
    return new StreamableFile(invoicePdf(inv), { type: 'application/pdf', disposition: `attachment; filename="${name}"` });
  }

  /** Dev tools (BILLING_DEV_TOOLS=1): 404 otherwise. */
  @Post('dev/advance')
  @HttpCode(200)
  advance(@CurrentCaller() caller: Caller, @Body(new ZodPipe(advanceSchema)) body: z.infer<typeof advanceSchema>) {
    return this.billing.devAdvance(caller.companyId, body.days, body.renewalOutcome);
  }

  @Post('dev/renew')
  @HttpCode(200)
  renew(@CurrentCaller() caller: Caller, @Body(new ZodPipe(renewSchema)) body: z.infer<typeof renewSchema>) {
    return this.billing.devRenew(caller.companyId, body.outcome);
  }
}

/**
 * Owner console (PLAN.md §21.1): Kaampilot staff accounts only. Every change writes one row in the staff audit log
 * (§21.7), which only staff can read (GET console/audit).
 */
@ReadOnlyOk()
@Controller('console')
export class ConsoleController {
  constructor(private readonly billing: BillingService) {}

  @Get('summary')
  async summary(@CurrentCaller() caller: Caller) {
    await this.billing.assertStaff(caller);
    return this.billing.consoleSummary();
  }

  @Get('companies')
  async companies(@CurrentCaller() caller: Caller) {
    await this.billing.assertStaff(caller);
    return this.billing.consoleCompanies();
  }

  /** Recent actions: `?company=<id or code>&action=&page=&pageSize=`, newest first. */
  @Get('audit')
  async audit(@CurrentCaller() caller: Caller, @Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>, @Query('export') exp?: string) {
    await this.billing.assertStaff(caller);
    // ?export=xlsx|csv: every action matching the filters as a file (PLAN.md §19.31)
    const format = exportFormat(exp);
    if (format) {
      const { header, rows } = await this.billing.consoleAuditSheet(q);
      return exportFile(format, 'console-actions', header, rows);
    }
    return this.billing.consoleAudit(q);
  }

  @Post('companies/:id/trial')
  @HttpCode(200)
  async trial(@CurrentCaller() caller: Caller, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(trialSchema)) body: z.infer<typeof trialSchema>) {
    const staff = await this.billing.assertStaff(caller);
    const companyId = uuidParam(id);
    return this.billing.consoleAction(staff, req.ip, 'trial.extend', companyId, body, () => this.billing.consoleTrial(companyId, body.days));
  }

  @Post('companies/:id/plan')
  @HttpCode(200)
  async plan(@CurrentCaller() caller: Caller, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    const staff = await this.billing.assertStaff(caller);
    const companyId = uuidParam(id);
    return this.billing.consoleAction(staff, req.ip, 'plan.set', companyId, body, () => this.billing.consolePlan(companyId, body.plan, body.seats));
  }

  @Post('companies/:id/status')
  @HttpCode(200)
  async status(@CurrentCaller() caller: Caller, @Req() req: Request, @Param('id') id: string, @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>) {
    const staff = await this.billing.assertStaff(caller);
    const companyId = uuidParam(id);
    const action = body.status === 'suspended' ? 'company.suspend' : 'company.reactivate';
    return this.billing.consoleAction(staff, req.ip, action, companyId, body, () => this.billing.consoleStatus(companyId, body.status));
  }
}
