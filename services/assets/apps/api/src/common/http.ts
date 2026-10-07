import {
  BadRequestException,
  ConflictException,
  createParamDecorator,
  type ExecutionContext,
  type PipeTransform,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';
import type { Permission } from '@eam/shared';
import type { Actor } from './actor';

export const IS_PUBLIC = 'eam:public';
export const PERMISSIONS_KEY = 'eam:permissions';

/** Route does not require a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires ANY of the given permissions. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export interface AuthedRequest extends Request {
  actor?: Actor;
  sessionId?: string;
}

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.actor as Actor;
});

/** Validates a request body (or query) with a shared zod schema. */
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
export const conflict = (message: string) => new ConflictException(message);
export const badRequest = (message: string, errors?: Record<string, string>) =>
  new BadRequestException(errors ? { message, errors } : message);

export interface ListParams {
  page: number;
  pageSize: number;
  offset: number;
  search: string;
  sort: string;
  dir: 'asc' | 'desc';
}

export function listParams(q: Record<string, unknown>, defaults: { sort: string; dir?: 'asc' | 'desc'; pageSize?: number }): ListParams {
  const page = Math.max(1, Number.parseInt(String(q.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(String(q.pageSize ?? defaults.pageSize ?? 25), 10) || 25));
  const search = typeof q.search === 'string' ? q.search.trim().slice(0, 200) : '';
  const sort = typeof q.sort === 'string' && q.sort ? q.sort : defaults.sort;
  const dir = q.dir === 'asc' || q.dir === 'desc' ? q.dir : (defaults.dir ?? 'desc');
  return { page, pageSize, offset: (page - 1) * pageSize, search, sort, dir };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Reads a comma separated list query param, e.g. `?status=AVAILABLE,ASSIGNED`. */
export function listFilter<T extends string>(value: unknown, allowed?: readonly T[]): T[] {
  if (typeof value !== 'string' || !value) return [];
  const items = value.split(',').map((v) => v.trim()).filter(Boolean) as T[];
  return allowed ? items.filter((v) => allowed.includes(v)) : items;
}

export function uuidParam(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

/** Escapes LIKE wildcards in user search text. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Today's date (server local time) as YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
