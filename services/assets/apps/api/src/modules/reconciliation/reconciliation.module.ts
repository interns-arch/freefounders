import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { reconUploadSchema, type ReconUploadInput } from '@eam/shared';
import type { Actor } from '../../common/actor';
import { CurrentActor, RequirePermissions, ZodPipe } from '../../common/http';
import { AssetsModule } from '../assets/assets.module';
import { ReconciliationService } from './reconciliation.service';

const addSimsSchema = z.object({ keys: z.array(z.string().min(1).max(40)).min(1).max(1000) });

@Controller('reconciliations')
@RequirePermissions('asset:assign', 'employee:manage')
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.recon.list(actor);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.recon.get(actor, id);
  }

  @Post(':id/add-sims')
  @HttpCode(200)
  addSims(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(addSimsSchema)) body: { keys: string[] }) {
    return this.recon.addSims(actor, id, body.keys);
  }

  @Post()
  run(@CurrentActor() actor: Actor, @Body(new ZodPipe(reconUploadSchema)) body: ReconUploadInput) {
    return this.recon.run(actor, body);
  }
}

@Module({
  imports: [AssetsModule],
  providers: [ReconciliationService],
  controllers: [ReconciliationController],
})
export class ReconciliationModule {}
