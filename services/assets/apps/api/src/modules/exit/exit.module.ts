import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  exitCancelSchema,
  exitItemUpdateSchema,
  type ExitItemUpdateInput,
  exitManualItemSchema,
  exitOverrideSchema,
  exitScanSchema,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { CurrentActor, ZodPipe } from '../../common/http';
import { AssetsModule } from '../assets/assets.module';
import { ExitService } from './exit.service';

@Controller('exit-cases')
export class ExitController {
  constructor(private readonly exits: ExitService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.exits.list(actor, q);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.exits.get(actor, id);
  }

  @Get(':id/history')
  history(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.exits.timeline(actor, id);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(exitItemUpdateSchema)) body: ExitItemUpdateInput,
  ) {
    return this.exits.updateItem(actor, id, itemId, body);
  }

  @Post(':id/items')
  addItem(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(exitManualItemSchema)) body: { assetName: string; notes?: string | null }) {
    return this.exits.addManualItem(actor, id, body);
  }

  @Post(':id/scan')
  @HttpCode(200)
  scan(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(exitScanSchema)) body: { code: string }) {
    return this.exits.scan(actor, id, body.code);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.exits.complete(actor, id);
  }

  @Post(':id/override')
  @HttpCode(200)
  override(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(exitOverrideSchema)) body: { reason: string }) {
    return this.exits.override(actor, id, body.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(exitCancelSchema)) body: { reason?: string | null }) {
    return this.exits.cancel(actor, id, body.reason);
  }
}

@Module({
  imports: [AssetsModule],
  providers: [ExitService],
  controllers: [ExitController],
  exports: [ExitService],
})
export class ExitModule {}
