/**
 * One HTTP client for the three APIs (Platform, Tasks, Assets). Platform-neutral: plain fetch, no DOM.
 * Every request carries the Platform access token (all three APIs accept it); a 401 renews it once and retries.
 */
import { config } from './config';
import { session } from './session';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Field errors, e.g. { email: 'Enter a valid email' } (from NestJS `errors` or DRF field lists). */
    public errors?: Record<string, string>,
    public data?: unknown,
  ) {
    super(message);
  }
}

/**
 * 402 = a plan, seat or read-only limit (PLAN.md §21.2). Every such answer, from any screen, reaches these listeners
 * (the web app shows its message as a toast), as well as the screen that asked.
 */
const paymentListeners = new Set<(err: ApiError) => void>();
export function onPaymentRequired(listener: (err: ApiError) => void): () => void {
  paymentListeners.add(listener);
  return () => paymentListeners.delete(listener);
}
function told(err: ApiError): ApiError {
  if (err.status === 402) paymentListeners.forEach((l) => l(err));
  return err;
}

export type Query = Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number>>;

/** "Something went wrong" text for any error, for screens. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

/**
 * Seconds until a throttled request may be tried again (429 with `retryAfterSeconds`, e.g. "ask for a new code"), or
 * null when the error is not that.
 */
export function retryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const n = Number((err.data as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** NestJS: {message, errors}. DRF: {detail} or {field: ["msg"]} or {field: "msg"}. */
function normalise(status: number, statusText: string, data: unknown): ApiError {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (typeof d.message === 'string' || Array.isArray(d.message)) {
      const message = Array.isArray(d.message) ? d.message.join(' · ') : (d.message as string);
      return new ApiError(status, message, d.errors as Record<string, string> | undefined, data);
    }
    if (typeof d.detail === 'string') return new ApiError(status, d.detail, undefined, data);
    const errors: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) errors[k] = v.join(' ');
      else if (typeof v === 'string') errors[k] = v;
    }
    if (Object.keys(errors).length) {
      const message = Object.entries(errors)
        .map(([k, v]) => (k === 'non_field_errors' ? v : `${k.replace(/_/g, ' ')}: ${v}`))
        .join(' · ');
      return new ApiError(status, message, errors, data);
    }
  }
  return new ApiError(status, typeof data === 'string' && data ? data : statusText || `Request failed (${status})`, undefined, data);
}

function buildUrl(base: string, path: string, query?: Query): string {
  const url = `${config.origin}${base}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

export interface Http {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
  /** multipart/form-data (files). */
  upload<T>(path: string, form: FormData, method?: string): Promise<T>;
  /** A file the screen shows or downloads (needs the token, so not a plain URL). */
  blob(path: string, query?: Query): Promise<Blob>;
}

export function createHttp(base: string): Http {
  async function send(method: string, path: string, body: unknown, query: Query | undefined, raw: boolean, retried = false): Promise<Response> {
    const token = session.token();
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    let res: Response;
    try {
      res = await config.fetch(buildUrl(base, path, query), {
        method,
        credentials: 'include',
        headers: {
          Accept: raw ? '*/*' : 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'Cannot reach FreeFounders. Check your connection.');
    }
    if (res.status === 401 && !retried) {
      if (await session.refresh()) return send(method, path, body, query, raw, true);
      session.signedOut();
    }
    return res;
  }

  async function json<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const res = await send(method, path, body, query, false);
    if (res.status === 204) return null as T;
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) throw told(normalise(res.status, res.statusText, data));
    return data as T;
  }

  return {
    get: (path, query) => json('GET', path, undefined, query),
    post: (path, body = {}) => json('POST', path, body),
    put: (path, body = {}) => json('PUT', path, body),
    patch: (path, body = {}) => json('PATCH', path, body),
    del: (path, body) => json('DELETE', path, body),
    upload: (path, form, method = 'POST') => json(method, path, form),
    async blob(path, query) {
      const res = await send('GET', path, undefined, query, true);
      if (!res.ok) throw told(normalise(res.status, res.statusText, null));
      return res.blob();
    },
  };
}

/** The three APIs on the shared FreeFounders address. */
export const platformApi = createHttp('/api/platform');
export const tasksApi = createHttp('/tasks/api');
export const assetsApi = createHttp('/assets/api');

/** Assets list endpoints answer with a page. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Tasks (DRF) list endpoints answer with a page, or a plain list when not paginated. */
export interface DrfPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export const resultsOf = <T>(data: DrfPage<T> | T[]): T[] => (Array.isArray(data) ? data : (data?.results ?? []));
