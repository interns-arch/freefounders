import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  onboardingAssignAllSchema,
  type OnboardingAssignAllInput,
  onboardingCancelSchema,
  onboardingCreateSchema,
  type OnboardingCreateInput,
  onboardingIssueSchema,
  type OnboardingIssueInput,
  onboardingItemSchema,
  type OnboardingItemInput,
  onboardingItemUpdateSchema,
  type OnboardingItemUpdateInput,
  onboardingKitSchema,
  type OnboardingKitInput,
  onboardingReturnSchema,
  onboardingUpdateSchema,
  type OnboardingUpdateInput,
} from '@eam/shared';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { CurrentActor, RequirePermissions, ZodPipe } from '../../common/http';
import { AssetsModule } from '../assets/assets.module';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingService } from './onboarding.service';

const addItemsSchema = z.object({ items: z.array(onboardingItemSchema).min(1).max(50) });

@Controller('onboarding')
@RequirePermissions('onboarding:manage', 'asset:assign')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.onboarding.list(actor, q);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(onboardingCreateSchema)) body: OnboardingCreateInput) {
    return this.onboarding.create(actor, body);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.get(actor, id);
  }

  @Get(':id/history')
  history(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.timeline(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(onboardingUpdateSchema)) body: OnboardingUpdateInput) {
    return this.onboarding.update(actor, id, body);
  }

  @Post(':id/items')
  addItems(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(addItemsSchema)) body: { items: OnboardingItemInput[] }) {
    return this.onboarding.addItems(actor, id, body.items);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(onboardingItemUpdateSchema)) body: OnboardingItemUpdateInput,
  ) {
    return this.onboarding.updateItem(actor, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  removeItem(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.onboarding.removeItem(actor, id, itemId);
  }

  @Post(':id/items/:itemId/issue')
  @HttpCode(200)
  issueItem(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodPipe(onboardingIssueSchema)) body: OnboardingIssueInput,
  ) {
    return this.onboarding.issueItem(actor, id, itemId, body);
  }

  @Post(':id/assign-all')
  @HttpCode(200)
  assignAll(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(onboardingAssignAllSchema)) body: OnboardingAssignAllInput) {
    return this.onboarding.assignAll(actor, id, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.approve(actor, id);
  }

  @Post(':id/send-back')
  @HttpCode(200)
  sendBack(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(onboardingReturnSchema)) body: { note: string }) {
    return this.onboarding.sendBack(actor, id, body.note);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.submit(actor, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.complete(actor, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(onboardingCancelSchema)) body: { reason: string }) {
    return this.onboarding.cancel(actor, id, body.reason);
  }
}

@Controller('onboarding-kits')
@RequirePermissions('onboarding:manage', 'asset:assign')
export class OnboardingKitsController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.onboarding.listKits(actor);
  }

  @Post()
  save(@CurrentActor() actor: Actor, @Body(new ZodPipe(onboardingKitSchema)) body: OnboardingKitInput) {
    return this.onboarding.saveKit(actor, body);
  }

  @Delete(':id')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.deleteKit(actor, id);
  }
}

@Module({
  imports: [AssetsModule, EmployeesModule],
  providers: [OnboardingService],
  controllers: [OnboardingController, OnboardingKitsController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
