import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  employeeAccessSchema,
  type EmployeeAccessInput,
  employeeCreateSchema,
  type EmployeeCreateInput,
  employeeSchema,
  type EmployeeInput,
  employeeStatusSchema,
  type EmployeeStatusInput,
  optText,
} from '@eam/shared';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { badRequest, CurrentActor, RequirePermissions, ZodPipe } from '../../common/http';
import { ExitModule } from '../exit/exit.module';
import { assertPeopleManagedHere, platformEnabled } from '../auth/platform-token';
import { EmployeesService } from './employees.service';
import { Exportable } from '../../common/export';
import { EXPORTS } from '../../common/export-specs';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @Exportable(EXPORTS.employees)
  list(@CurrentActor() actor: Actor, @Query() q: Record<string, string>) {
    return this.employees.list(actor, q);
  }

  @Get('lookup')
  lookup(@CurrentActor() actor: Actor, @Query('code') code: string) {
    if (!code) throw badRequest('Enter or scan a code');
    return this.employees.lookup(actor, code);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(actor, id);
  }

  @Get(':id/assets')
  assets(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.assets(actor, id);
  }

  @Get(':id/history')
  history(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: Record<string, string>) {
    return this.employees.timeline(actor, id, q);
  }

  @Post()
  @RequirePermissions('employee:manage')
  create(@CurrentActor() actor: Actor, @Body() raw: unknown) {
    // PLAN.md §26: with Platform sign-in on, new people are added in Admin → People (they arrive here with their login).
    assertPeopleManagedHere();
    const body: EmployeeCreateInput = new ZodPipe(employeeCreateSchema).transform(raw);
    return this.employees.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('employee:manage')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    // PLAN.md §26: with Platform sign-in on, only the Assets fields (location, company, personal contacts, notes) change
    // here; name, code, official email / phone, designation, department, manager and join date come from People.
    if (platformEnabled()) return this.employees.update(actor, id, new ZodPipe(employeeSchema.partial()).transform(raw), { identityLocked: true });
    return this.employees.update(actor, id, new ZodPipe(employeeSchema).transform(raw) as EmployeeInput);
  }

  @Post(':id/verify-assets')
  @HttpCode(200)
  verify(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ note: optText(500) }))) body: { note?: string | null }) {
    return this.employees.verifyAssets(actor, id, body.note);
  }

  @Post(':id/access')
  @HttpCode(200)
  @RequirePermissions('user:manage')
  access(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    assertPeopleManagedHere(); // logins and roles: Admin → People
    const body: EmployeeAccessInput = new ZodPipe(employeeAccessSchema).transform(raw);
    return this.employees.grantAccess(actor, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('employee:status')
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    assertPeopleManagedHere(); // notice / exit / switching off: Admin → People → Start exit (the exit case still runs here)
    const body: EmployeeStatusInput = new ZodPipe(employeeStatusSchema).transform(raw);
    return this.employees.changeStatus(actor, id, body);
  }
}

@Module({
  imports: [ExitModule],
  providers: [EmployeesService],
  controllers: [EmployeesController],
  exports: [EmployeesService],
})
export class EmployeesModule {}
