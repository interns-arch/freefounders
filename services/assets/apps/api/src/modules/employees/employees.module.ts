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
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
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
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(employeeCreateSchema)) body: EmployeeCreateInput) {
    return this.employees.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('employee:manage')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(employeeSchema)) body: EmployeeInput) {
    return this.employees.update(actor, id, body);
  }

  @Post(':id/verify-assets')
  @HttpCode(200)
  verify(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ note: optText(500) }))) body: { note?: string | null }) {
    return this.employees.verifyAssets(actor, id, body.note);
  }

  @Post(':id/access')
  @HttpCode(200)
  @RequirePermissions('user:manage')
  access(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(employeeAccessSchema)) body: EmployeeAccessInput) {
    return this.employees.grantAccess(actor, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('employee:status')
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(employeeStatusSchema)) body: EmployeeStatusInput) {
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
