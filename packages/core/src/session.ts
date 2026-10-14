/**
 * The FreeFounders sign-in (PLAN.md §13.4): a 15-minute access token kept in memory, renewed from the refresh
 * token (an httpOnly cookie on the web; secure storage on mobile). One renewal at a time for everybody.
 */
import { config } from './config';

export type AppKey = 'tasks' | 'assets';

export interface Claims {
  sub: string;
  cid: string;
  name?: string;
  role?: 'owner' | 'admin' | 'member';
  /** The apps this person can open, with their user id in each. */
  apps: Partial<Record<AppKey, string>>;
  /** Read-only company (subscription ended, PLAN.md §21.1): the APIs refuse writes with 402. */
  ro?: boolean;
  exp: number;
}

/** The tokens a sign-in answers with (the web gets the refresh token as a cookie; mobile in the body). */
export interface SignInTokens {
  accessToken: string;
  refreshToken?: string;
}

/** An account in several companies signs in in two steps: pick the company, then `session.loginWithTicket`. */
export interface CompanyChoice {
  companyId: string;
  name: string;
  code: string;
  role: string;
}
export interface ChooseCompany {
  chooseCompany: CompanyChoice[];
  ticket: string;
}

type Listener = () => void;

const AUTH = '/api/platform/auth';
let accessToken: string | null = null;
let claims: Claims | null = null;
let renewing: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

function decode(token: string): Claims | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(part) : '';
    // Bytes → UTF-8 text without the legacy escape() (not every JS engine has it, e.g. React Native's Hermes).
    const utf8 = json.replace(/[\s\S]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
    return JSON.parse(decodeURIComponent(utf8)) as Claims;
  } catch {
    return null;
  }
}

// Who is signed in, in which company: a change of either (sign-in, sign-out, company switch) tells the listeners.
const identity = (c: Claims | null) => (c ? `${c.sub}|${c.cid}` : null);

function set(token: string | null) {
  const before = identity(claims);
  accessToken = token;
  claims = token ? decode(token) : null;
  if (identity(claims) !== before) listeners.forEach((l) => l());
}

/** Mobile keeps the refresh token itself: requests that sign in say so (`client: 'mobile'`). */
function clientHint(): { client?: 'mobile' } {
  return config.refreshStore ? { client: 'mobile' } : {};
}

/** Keeps the tokens of a sign-in (sign-in, sign-up, company switch, invite accepted). */
async function keep(data: Partial<SignInTokens> & { message?: string }, status: number) {
  if (!data.accessToken) {
    const { ApiError } = await import('./http');
    throw new ApiError(status, data.message ?? 'Sign-in failed');
  }
  const store = config.refreshStore;
  if (store && data.refreshToken) await store.set(data.refreshToken);
  set(data.accessToken);
}

async function post(path: string, body: Record<string, unknown> = {}) {
  return config.fetch(`${config.origin}${AUTH}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
}

export const session = {
  token: () => accessToken,
  claims: () => claims,
  signedIn: () => !!accessToken,
  apps: (): AppKey[] => (claims ? (Object.keys(claims.apps ?? {}) as AppKey[]) : []),

  /** Renews the access token. False when the person is signed out. */
  refresh(): Promise<boolean> {
    renewing ??= (async () => {
      try {
        const store = config.refreshStore;
        const stored = store ? await store.get() : null;
        if (store && !stored) return false;
        const res = await post('/refresh', stored ? { refreshToken: stored } : {});
        if (!res.ok) {
          set(null);
          if (store) await store.set(null);
          return false;
        }
        const data = (await res.json()) as { accessToken: string; refreshToken?: string };
        if (store && data.refreshToken) await store.set(data.refreshToken);
        set(data.accessToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => setTimeout(() => (renewing = null), 0));
    return renewing;
  },

  clientHint,

  /**
   * Signs in with email, mobile, username or employee ID. An account in several companies gets the list to choose
   * from (PLAN.md §21.2); then `loginWithTicket`. Otherwise signed in, and nothing is returned.
   */
  async login(login: string, password: string): Promise<ChooseCompany | void> {
    const res = await post('/login', { login, password, ...clientHint() });
    const data = (await res.json().catch(() => ({}))) as Partial<SignInTokens & ChooseCompany> & { message?: string };
    if (res.ok && Array.isArray(data.chooseCompany) && data.ticket) return { chooseCompany: data.chooseCompany, ticket: data.ticket };
    await keep(res.ok ? data : { message: data.message }, res.status);
  },

  /** Second step of a sign-in with several companies. */
  async loginWithTicket(ticket: string, companyId: string): Promise<void> {
    const res = await post('/login', { ticket, companyId, ...clientHint() });
    const data = (await res.json().catch(() => ({}))) as Partial<SignInTokens> & { message?: string };
    await keep(res.ok ? data : { message: data.message }, res.status);
  },

  /** Takes over the tokens another request answered with (sign-up, company switch, new company, invite accepted). */
  adopt(data: Partial<SignInTokens>): Promise<void> {
    return keep(data, 200);
  },

  async logout() {
    // Mobile keeps the refresh token itself, so it names the session to end; the web's is in the cookie.
    const stored = config.refreshStore ? await config.refreshStore.get().catch(() => null) : null;
    await post('/logout', stored ? { refreshToken: stored } : {}).catch(() => null);
    if (config.refreshStore) await config.refreshStore.set(null);
    set(null);
  },

  /** A request was refused even after renewing: forget the token so the app shows sign-in. */
  signedOut() {
    set(null);
  },

  /** Called when the signed-in person changes (sign-in, sign-out, someone else). */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
