import { Global, Module } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CredentialVault } from './credential-vault.service';
import { HistoryController, NotificationsController } from './core.controller';
import { HistoryService } from './history.service';
import { NotificationsService } from './notifications.service';
import { SequenceService } from './sequence.service';

@Global()
@Module({
  providers: [DbService, HistoryService, SequenceService, NotificationsService, CredentialVault],
  controllers: [HistoryController, NotificationsController],
  exports: [DbService, HistoryService, SequenceService, NotificationsService, CredentialVault],
})
export class CoreModule {}
