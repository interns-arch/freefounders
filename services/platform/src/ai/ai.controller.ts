import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthedRequest, Public, ZodPipe } from '../common/http';
import { platformLog } from '../console/log-sink';
import { DbService } from '../db/db.service';
import { companies } from '../db/schema';
import { AiProviderError, AiRateLimit, aiRateLimits, AiService, describeAi, MAX_HISTORY, MAX_QUESTION } from './ai.service';

const askSchema = z.object({
  question: z.string().trim().min(1, 'Type a question').max(MAX_QUESTION, `Keep the question under ${MAX_QUESTION} characters`),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(MAX_HISTORY * 2)
    .optional(),
  page: z.string().max(300).optional(),
});
type AskBody = z.infer<typeof askSchema>;

export const AI_RATE_MESSAGE = 'Too many questions from this network. Please wait a few minutes.';

/**
 * "Ask Kaampilot" (PLAN.md §24.3). Both routes work signed out (landing page) and signed in; a valid access token only
 * adds the person's level and company name as context and raises the per-IP limit.
 */
@Controller('ai')
export class AiController {
  readonly limiter = new AiRateLimit();

  constructor(
    private readonly ai: AiService,
    private readonly dbs: DbService,
  ) {
    if (process.env.NODE_ENV !== 'test') new Logger('AI').log(describeAi());
  }

  /** Whether the helper button is shown. */
  @Public()
  @Get('status')
  status() {
    return { enabled: this.ai.enabled() };
  }

  @Public()
  @Post('ask')
  @HttpCode(200)
  async ask(@Body(new ZodPipe(askSchema)) body: AskBody, @Req() req: AuthedRequest) {
    const caller = req.caller;
    const limits = aiRateLimits();
    const key = `${caller ? 'in' : 'out'}:${req.ip ?? 'unknown'}`;
    const started = Date.now();
    const done = (status: number, upstream?: string | number) =>
      platformLog({
        level: status >= 500 ? 'warn' : 'info',
        event: 'ai.ask',
        // Never the question or the answer: only sizes and the outcome.
        message: `AI question (${body.question.length} chars, ${body.history?.length ?? 0} earlier turns, ${caller ? 'signed in' : 'signed out'}): ${status}${upstream !== undefined ? ` (provider ${upstream})` : ''} in ${Date.now() - started} ms`,
        status,
        path: '/api/platform/ai/ask',
        method: 'POST',
        companyId: caller?.companyId ?? null,
        userId: caller?.personId ?? null,
      });

    if (!this.limiter.take(key, caller ? limits.signedIn : limits.signedOut)) {
      done(429);
      throw new HttpException(AI_RATE_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const companyName = caller ? await this.companyName(caller.companyId) : undefined;
      const result = await this.ai.ask(body, { role: caller?.role, companyName });
      done(200);
      return result;
    } catch (err) {
      done(err instanceof HttpException ? err.getStatus() : 500, err instanceof AiProviderError ? err.upstream : undefined);
      throw err;
    }
  }

  private async companyName(companyId: string): Promise<string | undefined> {
    try {
      const [row] = await this.dbs.db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
      return row?.name;
    } catch {
      return undefined;
    }
  }
}
