import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  allocations_one_active_uq: 'This asset is already assigned. Transfer or return it first.',
  exit_cases_one_open_uq: 'This employee already has an open exit case.',
  exit_items_allocation_uq: 'This asset is already on the checklist.',
  assets_quantity_ck: 'Not enough quantity available.',
  field_definitions_category_key_uq: 'A field with this key already exists in the category.',
  field_definitions_type_key_uq: 'A field with this key already exists in the asset type.',
  asset_types_category_name_uq: 'An asset type with this name already exists in the category.',
};

function pgError(err: unknown): PgError | null {
  const candidates = [err, (err as { cause?: unknown })?.cause];
  for (const c of candidates) {
    if (c && typeof c === 'object' && typeof (c as PgError).code === 'string' && /^[0-9A-Z]{5}$/.test((c as PgError).code!)) {
      return c as PgError;
    }
  }
  return null;
}

function uniqueMessage(e: PgError): string {
  if (e.constraint && CONSTRAINT_MESSAGES[e.constraint]) return CONSTRAINT_MESSAGES[e.constraint];
  const m = /Key \(([^)]+)\)=\(([^)]*)\)/.exec(e.detail ?? '');
  if (m) return `${m[1].replace(/_/g, ' ')} "${m[2]}" is already in use.`;
  return 'This record already exists.';
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
    if (pg) {
      switch (pg.code) {
        case '23505':
          return void res.status(409).json({ statusCode: 409, message: uniqueMessage(pg) });
        case '23503':
          return void res
            .status(409)
            .json({ statusCode: 409, message: 'This record is in use by other records and cannot be removed.' });
        case '23514':
          return void res.status(400).json({
            statusCode: 400,
            message: (pg.constraint && CONSTRAINT_MESSAGES[pg.constraint]) || 'The data violates a business rule.',
          });
        case '42501':
          return void res.status(403).json({ statusCode: 403, message: 'History records are immutable.' });
        case '22P02':
          return void res.status(400).json({ statusCode: 400, message: 'Invalid identifier or value.' });
        case '40001':
        case '40P01':
          return void res.status(409).json({ statusCode: 409, message: 'The record was busy. Please try again.' });
      }
    }

    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Something went wrong. Please try again.' });
  }
}
