import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { type AuthedRequest, Public, ZodPipe } from '../common/http';
import { platformLog } from '../console/log-sink';
import { DbService } from '../db/db.service';
import { companies } from '../db/schema';
import { aiAddressKey, AiProviderError, AiRateLimit, aiRateLimits, AiService, type AskResult, describeAi, MAX_HISTORY, MAX_QUESTION, toolSummary } from './ai.service';

const bearerOf = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7).trim() || undefined : undefined);


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
 * "Ask Kaampilot" (PLAN.md §24.3). Both routes work signed out (landing page) and signed in; a valid access token adds
 * the person's name, level and company name as context, raises the per-IP limit and switches on the read-only data tools
 * (tools.ts), which call the apps with that same token so the apps' own permission checks decide what the AI sees.
 */
@Controller('ai')
export class AiController {
  readonly limiter = new AiRateLimit();

  constructor(
    private readonly ai: AiService,
    private readonly dbs: DbService,
    private readonly auth: AuthService,
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
    // The route is public, so the token was only signature-checked: a signed-out session, a switched-off person or a
    // suspended company is treated as signed out (no data tools, signed-out limits). Security audit 2026-10-29.
    const caller = req.caller && (await this.auth.isLive(req.caller)) ? req.caller : undefined;
    const limits = aiRateLimits();
    // IPv6: one key per /64 (one home or phone network), so rotating addresses inside it does not reset the limit.
    const key = `${caller ? 'in' : 'out'}:${aiAddressKey(req.ip)}`;
    const started = Date.now();
    const done = (status: number, upstream?: string | number, result?: AskResult) =>
      platformLog({
        level: status >= 500 ? 'warn' : 'info',
        event: 'ai.ask',
        // Never the question, the answer or what a tool returned: only sizes, tool names, outcomes and times.
        message: `AI question (${body.question.length} chars, ${body.history?.length ?? 0} earlier turns, ${caller ? 'signed in' : 'signed out'}): ${status}${upstream !== undefined ? ` (provider ${upstream})` : ''} in ${Date.now() - started} ms${toolSummary(result)}`,
        status,
        path: '/api/platform/ai/ask',
        method: 'POST',
        companyId: caller?.companyId ?? null,
        userId: caller?.personId ?? null,
      });

    // Signed out, all networks together (AI_RATE_SIGNED_OUT_TOTAL per 10 minutes, 0 = off): a cap on the provider bill.
    const overall = !caller && limits.signedOutTotal > 0 && !this.limiter.take('out:*', limits.signedOutTotal);
    if (overall || !this.limiter.take(key, caller ? limits.signedIn : limits.signedOut)) {
      done(429);
      throw new HttpException(AI_RATE_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      const companyName = caller ? await this.companyName(caller.companyId) : undefined;
      // Signed in: the data tools read the apps with this person's own access token (never a service token).
      const token = caller ? bearerOf(req.headers.authorization) : undefined;
      const user = caller && token ? { token, name: caller.name, role: caller.role, apps: caller.apps } : undefined;
      const result = await this.ai.ask(body, { role: caller?.role, companyName, user });
      done(200, undefined, result);
      return { answer: result.answer };
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
