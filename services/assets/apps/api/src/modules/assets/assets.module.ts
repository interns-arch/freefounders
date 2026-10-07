import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  assetCreateSchema,
  type AssetCreateInput,
  assetUpdateSchema,
  type AssetUpdateInput,
  assignSchema,
  type AssignInput,
  bulkAssetSchema,
  type BulkAssetInput,
  lifecycleSchema,
  type LifecycleInput,
  returnSchema,
  type ReturnInput,
  transferSchema,
  type TransferInput,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { badRequest, CurrentActor, notFound, RequirePermissions, ZodPipe } from '../../common/http';
import { CatalogModule } from '../catalog/catalog.module';
import { AllocationService } from './allocation.service';
import { AssetsService } from './assets.service';
import { HoldersService } from './holders.service';
import { LifecycleService } from './lifecycle.service';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_UPLOAD, PhotosService, type UploadedPhoto } from './photos.service';

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly allocation: AllocationService,
    private readonly lifecycle: LifecycleService,
    private readonly photos: PhotosService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.assets.list(actor, q);
  }

  @Get('lookup')
  lookup(@CurrentActor() actor: Actor, @Query('code') code: string) {
    if (!code) throw badRequest('Enter or scan a code');
    return this.assets.lookup(actor, code);
  }

  @Post()
  @RequirePermissions('asset:create')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(assetCreateSchema)) body: AssetCreateInput) {
    return this.assets.create(actor, body);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(@CurrentActor() actor: Actor, @Body(new ZodPipe(bulkAssetSchema)) body: BulkAssetInput) {
    return this.assets.bulk(actor, body);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.get(actor, id);
  }

  @Patch(':id')
  @RequirePermissions('asset:edit')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assetUpdateSchema)) body: AssetUpdateInput) {
    return this.assets.update(actor, id, body);
  }

  @Get(':id/history')
  history(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: Record<string, string>) {
    return this.assets.timeline(actor, id, q);
  }

  @Get(':id/allocations')
  allocations(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.allocationHistory(actor, id);
  }

  @Get(':id/ownership')
  ownership(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.ownershipHistory(actor, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('asset:assign')
  assign(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assignSchema)) body: AssignInput) {
    return this.allocation.assign(actor, id, body);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions('asset:assign')
  transfer(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(transferSchema)) body: TransferInput) {
    return this.allocation.transfer(actor, id, body);
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermissions('asset:assign')
  returnAsset(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(returnSchema)) body: ReturnInput) {
    return this.allocation.returnAsset(actor, id, body);
  }

  @Post(':id/photos')
  @UseInterceptors(FilesInterceptor('photos', MAX_PHOTOS_PER_UPLOAD, { limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_UPLOAD } }))
  uploadPhotos(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: UploadedPhoto[] | undefined,
    @Body() body: { allocationId?: string; kind?: string },
  ) {
    return this.photos.upload(actor, id, body?.allocationId, body?.kind, files);
  }

  @Get(':id/photos/:photoId')
  async photo(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Res() res: Response) {
    await this.assets.assertCanView(actor, id);
    const file = await this.photos.file(id, photoId);
    if (!file.data) throw notFound('Photo file');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.type(file.mimeType).send(file.data);
  }

  @Post(':id/lifecycle')
  @HttpCode(200)
  perform(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lifecycleSchema)) body: LifecycleInput) {
    return this.lifecycle.perform(actor, id, body);
  }
}

@Module({
  imports: [CatalogModule],
  providers: [AssetsService, AllocationService, LifecycleService, HoldersService, PhotosService],
  controllers: [AssetsController],
  exports: [AssetsService, AllocationService, LifecycleService, HoldersService, PhotosService],
})
export class AssetsModule {}
