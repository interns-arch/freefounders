import { Global, Module } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { HistoryController, NotificationsController } from './core.controller';
import { HistoryService } from './history.service';
import { NotificationsService } from './notifications.service';
import { ModuleGuard, ProfileService } from './profile.service';
import { OutboxService } from './outbox.service';
import { SequenceService } from './sequence.service';

@Global()
@Module({
  providers: [DbService, HistoryService, SequenceService, NotificationsService, ProfileService, ModuleGuard, OutboxService],
  controllers: [HistoryController, NotificationsController],
  exports: [DbService, HistoryService, SequenceService, NotificationsService, ProfileService, ModuleGuard, OutboxService],
})
export class CoreModule {}
