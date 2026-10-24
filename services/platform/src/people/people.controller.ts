import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Caller, CurrentCaller, Needs, uuidParam, ZodPipe } from '../common/http';
import { exportFile, exportFormat } from '../common/export';
import { PEOPLE_SCREEN } from '../roles/platform-permissions';
import { deletePersonSchema, grantSchema, importFileSchema, importRowsSchema, type PersonCreate, personCreateSchema, type PersonUpdate, personUpdateSchema, PeopleService, setLoginSchema } from './people.service';

/** People & access (PLAN.md §19.19: each action is its own Admin permission). */
@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Needs(...PEOPLE_SCREEN)
  @Get()
  async list(@CurrentCaller() caller: Caller, @Query('search') search?: string, @Query('export') exp?: string) {
    const q = typeof search === 'string' ? search : '';
    // ?export=xlsx|csv: every person matching the search, as a file (PLAN.md §19.31)
    const format = exportFormat(exp);
    if (format) {
      const { header, rows } = await this.people.exportRows(caller, q);
      return exportFile(format, 'people', header, rows);
    }
    return this.people.list(caller, q);
  }

  @Needs('people.manage')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body(new ZodPipe(personCreateSchema)) body: PersonCreate) {
    return this.people.create(caller, body);
  }

  /** Bulk import (PLAN.md §19.40): the template, a preview of the file (nothing saved), then the import of the rows. */
  @Needs('people.manage')
  @Get('import/template')
  importTemplate(@Query('format') format?: string) {
    return this.people.importTemplate(exportFormat(format) ?? 'xlsx');
  }

  @Needs('people.manage')
  @Post('import/preview')
  @HttpCode(200)
  importPreview(@CurrentCaller() caller: Caller, @Body(new ZodPipe(importFileSchema)) body: z.infer<typeof importFileSchema>) {
    return this.people.importPreview(caller, body);
  }

  @Needs('people.manage')
  @Post('import')
  @HttpCode(200)
  importPeople(@CurrentCaller() caller: Caller, @Body(new ZodPipe(importRowsSchema)) body: z.infer<typeof importRowsSchema>) {
    return this.people.importPeople(caller, body);
  }

  @Needs('people.manage')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(personUpdateSchema)) body: PersonUpdate) {
    return this.people.update(caller, uuidParam(id), body);
  }

  /** Deletes the person and their records in every app (PLAN.md §19.12). Body: { confirm: "<their full name>", options? } (PLAN.md §19.12). */
  @Needs('people.delete')
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(deletePersonSchema)) body: z.infer<typeof deletePersonSchema>) {
    return this.people.deletePerson(caller, uuidParam(id), body.confirm, body.options);
  }

  @Needs('people.passwords')
  @Put(':id/login')
  setLogin(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(setLoginSchema)) body: z.infer<typeof setLoginSchema>) {
    return this.people.setLogin(caller, uuidParam(id), body);
  }

  @Needs('people.passwords')
  @Delete(':id/login')
  @HttpCode(200)
  removeLogin(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.people.removeLogin(caller, uuidParam(id));
  }

  @Needs('people.manage')
  @Put(':id/apps/:app')
  grantApp(@CurrentCaller() caller: Caller, @Param('id') id: string, @Param('app') app: string, @Body(new ZodPipe(grantSchema)) body: z.infer<typeof grantSchema>) {
    return this.people.grantApp(caller, uuidParam(id), app, body.appRole);
  }

  @Needs('people.manage')
  @Delete(':id/apps/:app')
  @HttpCode(200)
  revokeApp(@CurrentCaller() caller: Caller, @Param('id') id: string, @Param('app') app: string) {
    return this.people.revokeApp(caller, uuidParam(id), app);
  }
}
