import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { HISTORY_ENTITY_TYPES } from '@eam/shared';
import type { Actor } from '../common/actor';
import { CurrentActor, listFilter, listParams, RequirePermissions, uuidParam } from '../common/http';
import { HistoryService } from './history.service';
import { NotificationsService } from './notifications.service';

@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @RequirePermissions('history:view')
  list(@Query() q: Record<string, string>) {
    const params = listParams(q, { sort: 'occurredAt', pageSize: 50 });
    const entityType = (HISTORY_ENTITY_TYPES as readonly string[]).includes(q.entityType) ? q.entityType : undefined;
    return this.history.list(
      {
        entityType,
        entityId: uuidParam(q.entityId),
        action: listFilter(q.action),
        from: q.from,
        to: q.to,
      },
      params,
    );
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.notifications.list(actor);
  }

  @Post('read')
  async read(@CurrentActor() actor: Actor, @Body() body: { ids?: string[] }) {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string').slice(0, 200) : undefined;
    await this.notifications.markRead(actor, ids);
    return { ok: true };
  }
}
