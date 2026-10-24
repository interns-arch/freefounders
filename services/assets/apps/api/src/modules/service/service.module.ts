import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  maintenanceSchema,
  type MaintenanceInput,
  maintenanceUpdateSchema,
  type MaintenanceUpdateInput,
  requestDecisionSchema,
  requestFulfilSchema,
  requestSchema,
  type RequestInput,
  ticketSchema,
  type TicketInput,
  ticketUpdateSchema,
  type TicketUpdateInput,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { CurrentActor, RequirePermissions, ZodPipe } from '../../common/http';
import { AssetsModule } from '../assets/assets.module';
import { BadgesService } from './badges.service';
import { MaintenanceService } from './maintenance.service';
import { QueueService } from './queue.service';
import { RequestsService } from './requests.service';
import { TicketsService } from './tickets.service';
import { Exportable } from '../../common/export';
import { EXPORTS } from '../../common/export-specs';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @Exportable(EXPORTS.requests)
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.requests.list(actor, q);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(actor, id);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(requestSchema)) body: RequestInput) {
    return this.requests.create(actor, body);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(requestDecisionSchema)) body: { decision: 'APPROVE' | 'REJECT'; note?: string | null }) {
    return this.requests.decide(actor, id, body.decision, body.note);
  }

  @Post(':id/fulfil')
  @HttpCode(200)
  fulfil(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(requestFulfilSchema)) body: { assetId: string; notes?: string | null }) {
    return this.requests.fulfil(actor, id, body.assetId, body.notes);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancel(actor, id);
  }
}

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @Exportable(EXPORTS.tickets)
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.tickets.list(actor, q);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(actor, id);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(ticketSchema)) body: TicketInput) {
    return this.tickets.create(actor, body);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ticketUpdateSchema)) body: TicketUpdateInput) {
    return this.tickets.update(actor, id, body);
  }
}

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @Exportable(EXPORTS.maintenance)
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.maintenance.list(actor, q);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(maintenanceSchema)) body: MaintenanceInput) {
    return this.maintenance.create(actor, body);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(maintenanceUpdateSchema)) body: MaintenanceUpdateInput) {
    return this.maintenance.update(actor, id, body);
  }
}

@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  @RequirePermissions('ticket:manage', 'request:approve', 'request:fulfil')
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.queue.list(actor, q);
  }
}

/** GET /badges: what waits for me in Assets, as counts for the menu and tab badges (PLAN.md §19.42). */
@Controller('badges')
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get()
  counts(@CurrentActor() actor: Actor) {
    return this.badges.counts(actor);
  }
}

@Module({
  imports: [AssetsModule],
  providers: [RequestsService, TicketsService, MaintenanceService, QueueService, BadgesService],
  controllers: [RequestsController, TicketsController, MaintenanceController, QueueController, BadgesController],
})
export class ServiceModule {}
