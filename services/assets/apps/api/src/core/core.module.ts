import { Global, Module } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { HistoryController, NotificationsController } from './core.controller';
import { HistoryService } from './history.service';
import { NotificationsService } from './notifications.service';
import { SequenceService } from './sequence.service';

@Global()
@Module({
  providers: [DbService, HistoryService, SequenceService, NotificationsService],
  controllers: [HistoryController, NotificationsController],
  exports: [DbService, HistoryService, SequenceService, NotificationsService],
})
export class CoreModule {}
