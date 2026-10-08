import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import { AdminOnly, type Caller, CurrentCaller, uuidParam, ZodPipe } from '../common/http';
import { exitSchema, FlowsService } from './flows.service';

@AdminOnly()
@Controller('people')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  /** Start someone's exit: Assets opens the exit case, Tasks makes the exit checklist (PLAN.md §17.4). */
  @Post(':id/exit')
  @HttpCode(200)
  startExit(@CurrentCaller() caller: Caller, @Param('id') id: string, @Body(new ZodPipe(exitSchema)) body: z.infer<typeof exitSchema>) {
    return this.flows.startExit(caller, uuidParam(id), body);
  }
}
