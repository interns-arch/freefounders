import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { exportFile, exportFormat } from '../common/export';
import { type Caller, CurrentCaller, Public, ReadOnlyOk, uuidParam, ZodPipe } from '../common/http';
import { BillingService } from '../billing/billing.service';
import { ConsoleDashboardService, type UsersQuery, usersQuerySchema } from './console.service';
import { ingestSchema, type LogsQuery, logsQuerySchema, LogsService } from './logs.service';

/**
 * Kaampilot console dashboard (PLAN.md §21.9): Kaampilot staff accounts only (same guard as the owner console,
 * `BillingService.assertStaff`: 403 for everyone else, company owners and admins included). Read-only: the only
 * changes stay the owner console's existing actions (ConsoleController).
 */
@ReadOnlyOk()
@Controller('console')
export class ConsoleDashboardController {
  constructor(
    private readonly billing: BillingService,
    private readonly dash: ConsoleDashboardService,
    private readonly logs: LogsService,
  ) {}

  @Get('overview')
  async overview(@CurrentCaller() caller: Caller) {
    await this.billing.assertStaff(caller);
    return this.dash.overview();
  }

  @Get('health')
  async health(@CurrentCaller() caller: Caller) {
    await this.billing.assertStaff(caller);
    return this.logs.health();
  }

  /** Every company with plan, users, last activity, modules (the list the screen searches, filters and sorts). */
  @Get('dashboard/companies')
  async companies(@CurrentCaller() caller: Caller) {
    await this.billing.assertStaff(caller);
    return this.dash.companies();
  }

  @Get('dashboard/companies/:id')
  async company(@CurrentCaller() caller: Caller, @Req() req: Request, @Param('id') id: string) {
    const staff = await this.billing.assertStaff(caller);
    const out = await this.dash.company(uuidParam(id));
    await this.dash.audit(staff, req.ip, 'view.company', { companyId: out.company.id, companyCode: out.company.code });
    return out;
  }

  @Get('users')
  async users(@CurrentCaller() caller: Caller, @Req() req: Request, @Query(new ZodPipe(usersQuerySchema)) q: UsersQuery, @Query('export') exp?: string) {
    const staff = await this.billing.assertStaff(caller);
    const format = exportFormat(exp);
    if (format) {
      await this.dash.audit(staff, req.ip, 'view.users', { details: { export: format, q: q.q ?? null } });
      const { header, rows } = await this.dash.usersSheet(q);
      return exportFile(format, 'console-users', header, rows);
    }
    return this.dash.users(q);
  }

  @Get('users/:kind/:id')
  async user(@CurrentCaller() caller: Caller, @Req() req: Request, @Param('kind') kind: string, @Param('id') id: string) {
    const staff = await this.billing.assertStaff(caller);
    if (kind !== 'account' && kind !== 'login') throw new ForbiddenException('Unknown user kind');
    const out = await this.dash.user(kind, uuidParam(id));
    await this.dash.audit(staff, req.ip, 'view.user', { details: { kind, id } });
    return out;
  }

  /** `?export=xlsx|csv&sheet=subscriptions|invoices|payments|months` downloads one table. */
  @Get('billing')
  async billingAll(@CurrentCaller() caller: Caller, @Req() req: Request, @Query('export') exp?: string, @Query('sheet') sheet?: string) {
    const staff = await this.billing.assertStaff(caller);
    const format = exportFormat(exp);
    await this.dash.audit(staff, req.ip, 'view.billing', { details: format ? { export: format, sheet: sheet ?? 'subscriptions' } : {} });
    if (format) {
      const { name, header, rows } = await this.dash.billingSheet(sheet ?? 'subscriptions');
      return exportFile(format, name, header, rows);
    }
    return this.dash.billingAll();
  }

  /** Production log: `?service=&level=&company=&from=&to=&q=&page=&pageSize=`, newest first; `&export=xlsx|csv`. */
  @Get('logs')
  async logList(@CurrentCaller() caller: Caller, @Req() req: Request, @Query(new ZodPipe(logsQuerySchema)) q: LogsQuery, @Query('export') exp?: string) {
    const staff = await this.billing.assertStaff(caller);
    const format = exportFormat(exp);
    await this.dash.audit(staff, req.ip, 'view.logs', { details: { company: q.company ?? null, ...(format ? { export: format } : {}) } });
    if (format) {
      const { header, rows } = await this.logs.sheet(q);
      return exportFile(format, 'production-log', header, rows);
    }
    return this.logs.list(q);
  }
}

/**
 * The log sink's intake (PLAN.md §21.9): Tasks, the Tasks worker and Assets post here. Mounted at `/internal/logs`,
 * outside `/api/platform`, so the public gateway never routes to it; LOG_SINK_TOKEN (optional) is checked too.
 */
@Public()
@Controller('internal')
export class LogsIngestController {
  constructor(private readonly logs: LogsService) {}

  @Post('logs')
  @HttpCode(202)
  async ingest(@Req() req: Request, @Body(new ZodPipe(ingestSchema)) body: z.infer<typeof ingestSchema>) {
    if (!this.logs.ingestAllowed(req.headers)) throw new ForbiddenException('Not allowed');
    return this.logs.ingest(body);
  }
}
