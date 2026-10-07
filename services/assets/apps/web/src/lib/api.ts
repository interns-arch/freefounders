import { ensurePlatformSession, PLATFORM, withBase } from './platform';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string>,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

function buildUrl(path: string, query?: Query): string {
  const url = withBase(`/api${path}`);
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Fired when the session has expired so the app can send the user to sign in. */
export const UNAUTHORIZED_EVENT = 'eam:unauthorized';

async function request<T>(method: string, path: string, body?: unknown, query?: Query, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    // Single login: the short session made from the Platform sign-in ran out; make a new one and retry once.
    if (res.status === 401 && PLATFORM && !retried && (await ensurePlatformSession())) {
      return request<T>(method, path, body, query, true);
    }
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const d = (data ?? {}) as { message?: string; errors?: Record<string, string> };
    throw new ApiError(res.status, d.message || res.statusText || 'Request failed', d.errors, data as Record<string, unknown>);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
