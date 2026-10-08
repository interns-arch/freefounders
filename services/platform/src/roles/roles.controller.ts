import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AdminOnly, type Caller, CurrentCaller, uuidParam, ZodPipe } from '../common/http';
import { personRolesSchema, roleInputSchema, type RoleInput, RolesService } from './roles.service';

/** The role builder (company owners and admins). */
@AdminOnly()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** What each of the company's apps offers: permissions, groups and allowed scopes. */
  @Get('roles/catalogue')
  catalogue(@CurrentCaller() caller: Caller) {
    return this.roles.catalogue(caller.companyId);
  }

  @Get('roles')
  list(@CurrentCaller() caller: Caller, @Query('archived') archived?: string) {
    return this.roles.list(caller, archived === 'true');
  }

  @Post('roles')
  create(@CurrentCaller() caller: Caller, @Body(new ZodPipe(roleInputSchema)) body: RoleInput) {
    return this.roles.create(caller, body);
  }

  @Patch('roles/:id')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(roleInputSchema.partial())) body: Partial<RoleInput>) {
    return this.roles.update(caller, uuidParam(id), body);
  }

  @Post('roles/:id/duplicate')
  duplicate(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.roles.duplicate(caller, uuidParam(id));
  }

  /** Archives the role (it is kept for history). */
  @Delete('roles/:id')
  @HttpCode(200)
  archive(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.roles.archive(caller, uuidParam(id));
  }

  @Put('people/:id/roles')
  setPersonRoles(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(personRolesSchema)) body: { roleIds: string[] }) {
    return this.roles.setPersonRoles(caller, uuidParam(id), body.roleIds);
  }
}
