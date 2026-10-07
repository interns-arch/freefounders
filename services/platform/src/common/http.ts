import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  NotFoundException,
  type PipeTransform,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';
import type { AppKey, PlatformRole } from '../db/schema';

export const IS_PUBLIC = 'ff:public';
export const ADMIN_ONLY = 'ff:admin';

/** Route does not need an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route needs a company owner or admin (Phase 1 stand-in for platform.users.manage). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

/** Who is calling, taken from a verified access token. */
export interface Caller {
  personId: string;
  companyId: string;
  name: string;
  role: PlatformRole;
  apps: Partial<Record<AppKey, string>>;
  sessionFamily?: string;
}

export interface AuthedRequest extends Request {
  caller?: Caller;
}

export const CurrentCaller = createParamDecorator((_data: unknown, ctx: ExecutionContext): Caller => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().caller as Caller;
});

/** Validates a body (or query) with a zod schema; errors come back as `{ message, errors }`. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      if (!errors[key]) errors[key] = issue.message;
    }
    const first = Object.entries(errors)[0];
    throw new BadRequestException({
      message: first ? (first[0] === '_' ? first[1] : `${first[0]}: ${first[1]}`) : 'Invalid input',
      errors,
    });
  }
}

export const notFound = (what: string) => new NotFoundException(`${what} not found`);
export const badRequest = (message: string, errors?: Record<string, string>) =>
  new BadRequestException(errors ? { message, errors } : message);

export function uuidParam(value: unknown): string {
  if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) return value;
  throw badRequest('Invalid identifier');
}
