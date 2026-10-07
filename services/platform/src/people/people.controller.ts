import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, type Caller, CurrentCaller, uuidParam, ZodPipe } from '../common/http';
import { grantSchema, type PersonCreate, personCreateSchema, type PersonUpdate, personUpdateSchema, PeopleService, setLoginSchema } from './people.service';

@AdminOnly()
@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  list(@CurrentCaller() caller: Caller, @Query('search') search?: string) {
    return this.people.list(caller, typeof search === 'string' ? search : '');
  }

  @Post()
  create(@CurrentCaller() caller: Caller, @Body(new ZodPipe(personCreateSchema)) body: PersonCreate) {
    return this.people.create(caller, body);
  }

  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(personUpdateSchema)) body: PersonUpdate) {
    return this.people.update(caller, uuidParam(id), body);
  }

  @Put(':id/login')
  setLogin(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(setLoginSchema)) body: z.infer<typeof setLoginSchema>) {
    return this.people.setLogin(caller, uuidParam(id), body);
  }

  @Delete(':id/login')
  @HttpCode(200)
  removeLogin(@CurrentCaller() caller: Caller, @Param('id') id: string) {
    return this.people.removeLogin(caller, uuidParam(id));
  }

  @Put(':id/apps/:app')
  grantApp(@CurrentCaller() caller: Caller, @Param('id') id: string, @Param('app') app: string, @Body(new ZodPipe(grantSchema)) body: z.infer<typeof grantSchema>) {
    return this.people.grantApp(caller, uuidParam(id), app, body.appRole);
  }

  @Delete(':id/apps/:app')
  @HttpCode(200)
  revokeApp(@CurrentCaller() caller: Caller, @Param('id') id: string, @Param('app') app: string) {
    return this.people.revokeApp(caller, uuidParam(id), app);
  }
}
