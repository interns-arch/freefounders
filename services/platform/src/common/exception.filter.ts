import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface PgError {
  code?: string;
  constraint?: string;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  people_email_uq: 'Another person already uses this email.',
  people_company_code_uq: 'Another person already has this employee ID.',
  logins_username_uq: 'This username is already taken.',
};

function pgError(err: unknown): PgError | null {
  for (const c of [err, (err as { cause?: unknown })?.cause]) {
    if (c && typeof c === 'object' && /^[0-9A-Z]{5}$/.test(String((c as PgError).code))) return c as PgError;
  }
  return null;
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
      res.status(409).json({ statusCode: 409, message: (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) || 'This record already exists.' });
      return;
    }
    if (pg?.code === '22P02') {
      res.status(400).json({ statusCode: 400, message: 'Invalid identifier or value.' });
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Something went wrong. Please try again.' });
  }
}
