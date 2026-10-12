import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import { type Caller, CurrentCaller, Needs, uuidParam, ZodPipe } from '../common/http';
import { departmentSchema, DirectoryService } from './directory.service';

/** The company's department list (Settings), used by People and pushed to every app. */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly directory: DirectoryService) {}

  /** Everyone signed in may read the list (forms in the apps show it). */
  @Get()
  list(@CurrentCaller() caller: Caller) {
    return this.directory.listDepartments(caller);
  }

  @Needs('company.settings')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body(new ZodPipe(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    return this.directory.createDepartment(caller, body);
  }

  @Needs('company.settings')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(departmentSchema.partial())) body: Partial<z.infer<typeof departmentSchema>>) {
    return this.directory.updateDepartment(caller, uuidParam(id), body);
  }
}
