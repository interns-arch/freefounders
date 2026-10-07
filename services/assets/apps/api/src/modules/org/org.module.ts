import { Body, Controller, Delete, Get, Inject, Module, Param, ParseUUIDPipe, Patch, Post, Query, type Type } from '@nestjs/common';
import type { Actor } from '../../common/actor';
import { CurrentActor, RequirePermissions, ZodPipe } from '../../common/http';
import { type OrgKind, OrgService } from './org.service';

/** Builds a REST controller for one kind of master data (all share the same shape). */
function orgController(kind: OrgKind): Type<unknown> {
  @Controller(kind)
  class OrgController {
    constructor(@Inject(OrgService) private readonly org: OrgService) {}

    @Get()
    list(@Query() q: Record<string, string>) {
      return this.org.list(kind, q);
    }

    @Get(':id')
    get(@Param('id', ParseUUIDPipe) id: string) {
      return this.org.get(kind, id);
    }

    @Post()
    @RequirePermissions('org:manage')
    create(@CurrentActor() actor: Actor, @Body() body: unknown) {
      return this.org.create(kind, actor, new ZodPipe(this.org.schema(kind)).transform(body));
    }

    @Patch(':id')
    @RequirePermissions('org:manage')
    update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
      return this.org.update(kind, actor, id, new ZodPipe(this.org.schema(kind)).transform(body));
    }

    @Delete(':id')
    @RequirePermissions('org:manage')
    remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
      return this.org.remove(kind, actor, id);
    }
  }
  Object.defineProperty(OrgController, 'name', { value: `${kind}Controller` });
  return OrgController;
}

@Module({
  providers: [OrgService],
  controllers: [orgController('companies'), orgController('departments'), orgController('locations'), orgController('vendors')],
  exports: [OrgService],
})
export class OrgModule {}
