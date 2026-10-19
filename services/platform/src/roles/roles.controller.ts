import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { type Caller, CurrentCaller, Needs, uuidParam, ZodPipe } from '../common/http';
import { PEOPLE_SCREEN } from './platform-permissions';
import { personalAccessSchema, personRolesSchema, roleInputSchema, type RoleInput, RolesService, roleUpdateSchema } from './roles.service';
import { z } from 'zod';

/** The role builder (the Manage roles permission; PLAN.md §19.19). */
@Needs('roles.manage')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** What each of the company's apps offers: permissions, groups and allowed scopes. */
  @Needs('roles.manage', ...PEOPLE_SCREEN)
  @Get('roles/catalogue')
  catalogue(@CurrentCaller() caller: Caller) {
    return this.roles.catalogue(caller.companyId);
  }

  @Needs('roles.manage', ...PEOPLE_SCREEN)
  @Get('roles')
  list(@CurrentCaller() caller: Caller, @Query('archived') archived?: string) {
    return this.roles.list(caller, archived === 'true');
  }

  @Post('roles')
  create(@CurrentCaller() caller: Caller, @Body(new ZodPipe(roleInputSchema)) body: RoleInput) {
    return this.roles.create(caller, body);
  }

  @Patch('roles/:id')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(roleUpdateSchema)) body: Partial<RoleInput>) {
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

  /** A person's access: their roles, what those give, and their own extra access and duties (PLAN.md §19.28). */
  @Needs('roles.manage', ...PEOPLE_SCREEN)
  @Get('people/:id/access')
  personAccess(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.roles.personAccess(caller, uuidParam(id));
  }

  /** Extra access (permissions + scope on top of the roles) and responsibilities for this person only. */
  @Put('people/:id/access/personal')
  setPersonalAccess(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(personalAccessSchema)) body: z.infer<typeof personalAccessSchema>) {
    return this.roles.setPersonalAccess(caller, uuidParam(id), body);
  }

  /** "Make Admin" / "Make Member": Admin replaces Member or the other way round; other roles stay. */
  @Put('people/:id/level')
  setLevel(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(z.object({ level: z.enum(['admin', 'member']) }))) body: { level: 'admin' | 'member' }) {
    return this.roles.setLevel(caller, uuidParam(id), body.level);
  }

  @Put('people/:id/roles')
  setPersonRoles(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(personRolesSchema)) body: { roleIds: string[] }) {
    return this.roles.setPersonRoles(caller, uuidParam(id), body.roleIds);
  }
}
