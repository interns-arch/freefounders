import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { ALL_PERMISSIONS } from '@eam/shared';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { type AuthedRequest, Public, ZodPipe } from '../../common/http';
import { HistoryService } from '../../core/history.service';
import { OutboxService } from '../../core/outbox.service';
import { DbService } from '../../db/db.service';
import { assets, employees, exitCases, onboardingCases, onboardingKits, tickets, users } from '../../db/schema';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { bearerToken, SERVICE_AUDIENCE, verifyPlatformToken } from './platform-token';

/** The Platform acting on a company's behalf for a cross-app rule: may do anything, recorded under its own name. */
const PLATFORM: Actor = {
  userId: null,
  name: 'Kaampilot automation',
  email: null,
  employeeId: null,
  roleName: 'System',
  permissions: new Set(ALL_PERMISSIONS),
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const exitSchema = z.object({ personId: z.string().uuid(), lastWorkingDate: date, reason: z.string().max(300).nullable().optional() });
const joinerSchema = z.object({ personId: z.string().uuid(), joinDate: date, roleNames: z.array(z.string().max(120)).max(50).optional().default([]) });
const linkSchema = z.object({ assigneePersonId: z.string().uuid().nullable().optional(), ref: z.string().max(40), url: z.string().max(300).startsWith('/') });
const resolveSchema = z.object({ resolution: z.string().max(2000).nullable().optional() });
const gateMoveSchema = z.object({
  kind: z.enum(['passed', 'returned']),
  passNo: z.string().max(20),
  direction: z.enum(['out', 'in']),
  purpose: z.string().max(200).optional().default(''),
  returnable: z.boolean().optional().default(false),
  expectedReturn: date.nullable().optional(),
  carrier: z.string().max(120).nullable().optional(),
  by: z.string().max(120).nullable().optional(),
  assets: z.array(z.object({ id: z.string().uuid(), tag: z.string().max(60).optional() })).min(1).max(50),
});

/**
 * What the Kaampilot Platform's cross-app rules need from Assets (PLAN.md §17.4). Platform service token only.
 */
@Controller('internal')
export class InternalFlowsController {
  constructor(
    private readonly dbs: DbService,
    private readonly outbox: OutboxService,
    private readonly history: HistoryService,
    private readonly employeesSvc: EmployeesService,
    private readonly onboarding: OnboardingService,
  ) {}

  private async requireService(req: AuthedRequest) {
    const token = bearerToken(req.headers.authorization);
    const claims = token ? await verifyPlatformToken(token, SERVICE_AUDIENCE) : null;
    if (!claims || claims.sub !== 'platform') throw new UnauthorizedException('Platform service token required');
  }

  private async employeeOf(personId: string) {
    const [u] = await this.dbs.db.select({ employeeId: users.employeeId }).from(users).where(eq(users.platformPersonId, personId)).limit(1);
    if (!u?.employeeId) throw new NotFoundException('This person has no employee record in Assets');
    return u.employeeId;
  }

  @Public()
  @Get('events')
  async events(@Req() req: AuthedRequest, @Query('after') after?: string) {
    await this.requireService(req);
    const rows = await this.outbox.after(Math.max(0, Number(after) || 0));
    return rows.map((r) => ({ id: r.id, type: r.type, payload: r.payload, createdAt: r.createdAt }));
  }

  /** Exit started in the portal: the employee goes on notice and the exit case lists the assets they hold. */
  @Public()
  @Post('exits')
  @HttpCode(200)
  async startExit(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(exitSchema).transform(raw);
    const employeeId = await this.employeeOf(input.personId);
    const [emp] = await this.dbs.db.select({ status: employees.status }).from(employees).where(eq(employees.id, employeeId));
    if (emp?.status === 'JOINING') {
      throw new ConflictException('This person is still being onboarded in Assets: cancel the onboarding first');
    }
    const res = await this.employeesSvc.changeStatus(PLATFORM, employeeId, { status: 'NOTICE_PERIOD', lastWorkingDate: input.lastWorkingDate, reason: input.reason ?? undefined } as never);
    const [c] = await this.dbs.db.select({ caseNumber: exitCases.caseNumber, id: exitCases.id }).from(exitCases).where(eq(exitCases.id, (res as { exitCaseId: string }).exitCaseId));
    return { exitCaseId: c?.id ?? null, caseNumber: c?.caseNumber ?? null, url: c ? `/assets/exits/${c.id}` : null };
  }

  /** A new joiner: an onboarding case for their (existing) employee record, with the kit named like one of their roles. */
  @Public()
  @Post('onboarding')
  @HttpCode(200)
  async startOnboarding(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(joinerSchema).transform(raw);
    const employeeId = await this.employeeOf(input.personId);
    const [open] = await this.dbs.db
      .select({ id: onboardingCases.id, caseNumber: onboardingCases.caseNumber })
      .from(onboardingCases)
      .where(and(eq(onboardingCases.employeeId, employeeId), notInArray(onboardingCases.status, ['COMPLETED', 'CANCELLED'])))
      .limit(1);
    if (open) return { onboardingId: open.id, caseNumber: open.caseNumber, created: false };
    const names = input.roleNames.map((n) => n.toLowerCase());
    const [kit] = names.length
      ? await this.dbs.db.select({ id: onboardingKits.id }).from(onboardingKits).where(inArray(sql`lower(${onboardingKits.name})`, names)).limit(1)
      : [];
    const c = await this.onboarding.createForEmployee(PLATFORM, employeeId, input.joinDate, kit?.id ?? null);
    return { onboardingId: c.id, caseNumber: c.caseNumber, created: true, kit: !!kit };
  }

  /** A Tasks task now works on this ticket: shown on the ticket; its owner becomes the assignee. */
  @Public()
  @Put('tickets/:id/link')
  async linkTicket(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(linkSchema).transform(raw);
    const [assignee] = input.assigneePersonId
      ? await this.dbs.db.select({ id: users.id }).from(users).where(eq(users.platformPersonId, input.assigneePersonId)).limit(1)
      : [];
    const [t] = await this.dbs.db
      .update(tickets)
      .set({ linkedTask: { ref: input.ref, url: input.url }, ...(assignee ? { assigneeId: assignee.id } : {}), updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning({ id: tickets.id, number: tickets.number, assetId: tickets.assetId });
    if (!t) throw new NotFoundException('Ticket not found');
    await this.history.record(PLATFORM, {
      entityType: 'TICKET',
      entityId: t.id,
      entityLabel: t.number,
      action: 'UPDATED',
      summary: `Task ${input.ref} created in Tasks for this ticket`,
      assetId: t.assetId,
    });
    return { ok: true };
  }

  /** The linked task was completed in Tasks: the ticket is resolved with its remarks. */
  @Public()
  @Post('tickets/:id/resolve')
  @HttpCode(200)
  async resolveTicket(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(resolveSchema).transform(raw);
    const [t] = await this.dbs.db.select().from(tickets).where(eq(tickets.id, id));
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') return { ok: true, already: true };
    const resolution = input.resolution?.trim() || `Done in Tasks (${t.linkedTask?.ref ?? 'task'})`;
    await this.dbs.db.update(tickets).set({ status: 'RESOLVED', resolution, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(tickets.id, id));
    await this.history.record(PLATFORM, {
      entityType: 'TICKET',
      entityId: id,
      entityLabel: t.number,
      action: 'STATUS_RESOLVED',
      summary: `Resolved: the task ${t.linkedTask?.ref ?? ''} was completed in Tasks`.replace('  ', ' '),
      assetId: t.assetId,
    });
    return { ok: true };
  }

  /**
   * Visitors' material gate pass (PLAN.md §22.10): an asset went out of (or came in through) the gate, or came back.
   * Recorded in each asset's history; nothing else changes (custody stays as it is).
   */
  @Public()
  @Post('assets/gate-movement')
  @HttpCode(200)
  async gateMovement(@Req() req: AuthedRequest, @Body() raw: unknown) {
    await this.requireService(req);
    const input = new ZodPipe(gateMoveSchema).transform(raw);
    const ids = [...new Set(input.assets.map((a) => a.id))];
    const found = await this.dbs.db.select({ id: assets.id, tag: assets.assetTag }).from(assets).where(inArray(assets.id, ids));
    const back = input.kind === 'returned';
    const what = back
      ? `Came back through the gate (material pass ${input.passNo})`
      : `${input.direction === 'out' ? 'Went out' : 'Came in'} through the gate on material pass ${input.passNo}`;
    const extra = [
      input.purpose,
      !back && input.returnable ? `returnable${input.expectedReturn ? `, expected back ${input.expectedReturn}` : ''}` : null,
      input.carrier ? `carried by ${input.carrier}` : null,
      input.by ? `guard ${input.by}` : null,
    ].filter(Boolean);
    await this.history.recordMany(
      PLATFORM,
      found.map((a) => ({
        entityType: 'ASSET' as const,
        entityId: a.id,
        entityLabel: a.tag,
        action: back ? 'GATE_RETURNED' : 'GATE_PASS',
        summary: `${what}${extra.length ? ` · ${extra.join(' · ')}` : ''}`.slice(0, 500),
        metadata: { passNo: input.passNo, direction: input.direction, returnable: input.returnable, source: 'visitors' },
      })),
    );
    return { ok: true, recorded: found.length, unknown: ids.length - found.length };
  }
}
