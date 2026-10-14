import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { type Caller, CurrentCaller, Needs, Public, ReadOnlyOk, uuidParam, ZodPipe } from '../common/http';
import {
  advanceSchema,
  BillingService,
  checkoutSchema,
  outcomeSchema,
  profileSchema,
  renewSchema,
  seatsSchema,
} from './billing.service';

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

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentCaller() caller: Caller) {
    return this.billing.resume(caller.companyId);
  }

  @Get('invoices')
  invoices(@CurrentCaller() caller: Caller) {
    return this.billing.invoices(caller.companyId);
  }

  @Get('invoices/:id')
  invoice(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.billing.invoice(caller.companyId, uuidParam(id));
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

/** Owner console (PLAN.md §21.1): FreeFounders staff accounts only. */
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

  @Post('companies/:id/trial')
  @HttpCode(200)
  async trial(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(trialSchema)) body: z.infer<typeof trialSchema>) {
    await this.billing.assertStaff(caller);
    return this.billing.consoleTrial(uuidParam(id), body.days);
  }

  @Post('companies/:id/plan')
  @HttpCode(200)
  async plan(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    await this.billing.assertStaff(caller);
    return this.billing.consolePlan(uuidParam(id), body.plan, body.seats);
  }

  @Post('companies/:id/status')
  @HttpCode(200)
  async status(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>) {
    await this.billing.assertStaff(caller);
    return this.billing.consoleStatus(uuidParam(id), body.status);
  }
}
