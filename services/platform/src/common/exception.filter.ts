import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { platformException } from '../console/log-sink';
import type { AuthedRequest } from './http';

interface PgError {
  code?: string;
  constraint?: string;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  people_email_uq: 'Another person already uses this email.',
  people_company_code_uq: 'Another person already has this employee ID.',
  logins_username_uq: 'This username is already taken.',
  people_company_email_uq: 'Another person in this company already uses this email.',
  accounts_email_uq: 'An account with this email already exists.',
  accounts_mobile_uq: 'An account with this mobile number already exists.',
  accounts_username_uq: 'This username is already taken. Try another.',
};
/** Constraints the web shows next to one field. */
const UNIQUE_FIELDS: Record<string, string> = { accounts_username_uq: 'username' };

function pgError(err: unknown): PgError | null {
  for (const c of [err, (err as { cause?: unknown })?.cause]) {
    if (c && typeof c === 'object' && /^[0-9A-Z]{5}$/.test(String((c as PgError).code))) return c as PgError;
  }
  return null;
}

/**
 * A failed query's message lists its values ("params: …"): password hashes, token hashes, emails. Logs keep the SQL
 * (useful) but never the values.
 */
export function redact(text: string): string {
  return text.replace(/\bparams: [^\n]*/g, 'params: [hidden]');
}

/** Consistent JSON errors: `{ statusCode, message, errors? }`. Database errors become friendly 4xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : { statusCode: status, ...(body as object), message: (body as { message?: unknown }).message ?? exception.message };
      if (Array.isArray(payload.message)) payload.message = payload.message.join(', ');
      res.status(status).json(payload);
      return;
    }

    const pg = pgError(exception);
    if (pg?.code === '23505') {
      const message = (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) || 'This record already exists.';
      const field = pg.constraint ? UNIQUE_FIELDS[pg.constraint] : undefined;
      res.status(409).json({ statusCode: 409, message, ...(field ? { field, errors: { [field]: message } } : {}) });
      return;
    }
    if (pg?.code === '22P02') {
      res.status(400).json({ statusCode: 400, message: 'Invalid identifier or value.' });
      return;
    }

    this.logger.error(redact(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)));
    // Production log (PLAN.md §21.9): method, path (no query), company and person; never the body or headers.
    try {
      const req = host.switchToHttp().getRequest<AuthedRequest>();
      platformException(exception, {
        event: 'request.failed',
        level: 'error',
        method: req?.method ?? null,
        path: req?.originalUrl ?? req?.url ?? null,
        status: 500,
        companyId: req?.caller?.companyId ?? null,
        userId: req?.caller?.personId ?? null,
      });
    } catch {
      // logging never changes the answer
    }
    res.status(500).json({ statusCode: 500, message: 'Something went wrong. Please try again.' });
  }
}
