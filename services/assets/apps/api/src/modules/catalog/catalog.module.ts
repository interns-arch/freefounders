import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  assetTypeSchema,
  type AssetTypeInput,
  categorySchema,
  type CategoryInput,
  fieldDefinitionSchema,
  type FieldDefinitionInput,
  fieldUpdateSchema,
  type FieldUpdateInput,
  reorderSchema,
} from '@eam/shared';
import type { Actor } from '../../common/actor';
import { CurrentActor, RequirePermissions, uuidParam, ZodPipe } from '../../common/http';
import { CatalogService } from './catalog.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list() {
    return this.catalog.listCategories();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getCategory(id);
  }

  @Post()
  @RequirePermissions('catalog:manage')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(categorySchema)) body: CategoryInput) {
    return this.catalog.createCategory(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('catalog:manage')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categorySchema)) body: CategoryInput) {
    return this.catalog.updateCategory(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('catalog:manage')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteCategory(actor, id);
  }
}

@Controller('asset-types')
export class AssetTypesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@Query() q: Record<string, string>) {
    return this.catalog.listTypes({ categoryId: uuidParam(q.categoryId), search: q.search?.trim() });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getType(id);
  }

  @Post()
  @RequirePermissions('catalog:manage')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(assetTypeSchema)) body: AssetTypeInput) {
    return this.catalog.createType(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('catalog:manage')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(assetTypeSchema)) body: AssetTypeInput) {
    return this.catalog.updateType(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('catalog:manage')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteType(actor, id);
  }
}

@Controller('fields')
export class FieldsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@Query() q: Record<string, string>) {
    return this.catalog.listFields({
      categoryId: uuidParam(q.categoryId),
      assetTypeId: uuidParam(q.assetTypeId),
      includeArchived: q.includeArchived === '1',
    });
  }

  @Get('filterable')
  filterable(@Query() q: Record<string, string>) {
    return this.catalog.filterableFields({ categoryId: uuidParam(q.categoryId), assetTypeId: uuidParam(q.assetTypeId) });
  }

  @Post()
  @RequirePermissions('catalog:manage')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(fieldDefinitionSchema)) body: FieldDefinitionInput) {
    return this.catalog.createField(actor, body);
  }

  @Post('reorder')
  @RequirePermissions('catalog:manage')
  reorder(@Body(new ZodPipe(reorderSchema)) body: { ids: string[] }) {
    return this.catalog.reorderFields(body.ids);
  }

  @Patch(':id')
  @RequirePermissions('catalog:manage')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fieldUpdateSchema)) body: FieldUpdateInput) {
    return this.catalog.updateField(actor, id, body);
  }

  @Post(':id/restore')
  @RequirePermissions('catalog:manage')
  restore(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.restoreField(actor, id);
  }

  @Delete(':id')
  @RequirePermissions('catalog:manage')
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteField(actor, id);
  }
}

@Module({
  providers: [CatalogService],
  controllers: [CategoriesController, AssetTypesController, FieldsController],
  exports: [CatalogService],
})
export class CatalogModule {}
