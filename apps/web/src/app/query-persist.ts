/**
 * Show the last data instantly (PLAN.md §19.18): a few small, personal queries are kept on this device (localStorage
 * `ff-query-cache`), so after a reload the Home and Attendance screens draw at once from the saved copy while the app
 * fetches fresh data in the background (TanStack Query's persistence, `@tanstack/query-persist-client-core`).
 *
 * Safety: the saved copy belongs to one person in one company (`sub|cid` of the sign-in) and is only read back for that
 * same person after their session was renewed; it is dropped on sign-out, when someone else signs in, after 24 hours
 * and with every new build (buster = build id). Only the queries in SAFE are written, never mutations.
 */
import { type Claims, session } from '@kaampilot/core';
import { type Persister, persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/query-persist-client-core';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

const KEY = 'ff-query-cache';
const MAX_AGE = 24 * 60 * 60 * 1000;
const BUSTER = typeof __FF_BUILD_ID__ === 'string' ? __FF_BUILD_ID__ : 'dev';

/** Key prefixes worth showing before the network answers: who I am, today's attendance, balances, my counts. */
const SAFE: readonly (readonly unknown[])[] = [
  ['platform', 'me'],
  ['tasks', 'me'],
  ['assets', 'me'],
  ['assets', 'config'],
  ['hr', 'today'],
  ['hr', 'config'],
  ['hr', 'balances'],
  ['hr', 'leaves', 'pending'],
  ['hr', 'corrections', 'pending'],
  ['tasks', 'dashboard', 'my'],
  ['tasks', 'home'],
  ['task-completions', 'waiting-counts'],
  ['assets', 'dashboard'],
  ['notifications'],
];

export const isPersisted = (key: QueryKey) => SAFE.some((prefix) => prefix.every((part, i) => key[i] === part));

const identityOf = (c: Claims | null) => (c ? `${c.sub}|${c.cid}` : null);

function read(): { identity: string; client: unknown } | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
function remove() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/** localStorage, one copy for one identity, written at most once a second (weak phones) and when the page goes away. */
function persisterFor(identity: string): Persister & { dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: unknown = null;
  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending == null) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ identity, client: pending }));
    } catch {
      remove(); // full or blocked: better nothing than half
    }
    pending = null;
  };
  const flush = () => (document.visibilityState === 'hidden' ? write() : undefined);
  window.addEventListener('pagehide', write);
  document.addEventListener('visibilitychange', flush);
  return {
    persistClient(client) {
      pending = client;
      timer ??= setTimeout(write, 1000);
    },
    restoreClient() {
      const saved = read();
      return (saved && saved.identity === identity ? saved.client : undefined) as never;
    },
    removeClient() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
      remove();
    },
    dispose() {
      window.removeEventListener('pagehide', write);
      document.removeEventListener('visibilitychange', flush);
      this.removeClient();
    },
  };
}

let current: { identity: string; ready: Promise<void>; stop: () => void } | null = null;

/**
 * Follows the sign-in: for a signed-in person it restores their saved copy (if any) and keeps it up to date; on
 * sign-out or a different person it stops and deletes the copy (and empties the in-memory cache for a new person).
 */
export function installQueryPersistence(queryClient: QueryClient) {
  const follow = () => {
    const identity = identityOf(session.claims());
    if (identity === (current?.identity ?? null)) return;
    const before = current;
    current?.stop();
    current = null;
    if (before || !identity) {
      // Signed out, or someone else signed in: nothing of the previous person stays, on disk or in memory.
      remove();
      if (before && identity) queryClient.clear();
    }
    if (!identity) return;
    const persister = persisterFor(identity);
    let unsubscribe: (() => void) | undefined;
    let stopped = false;
    const ready = persistQueryClientRestore({ queryClient, persister, maxAge: MAX_AGE, buster: BUSTER })
      .catch(() => remove())
      .then(() => {
        if (stopped) return;
        unsubscribe = persistQueryClientSubscribe({
          queryClient,
          persister,
          buster: BUSTER,
          dehydrateOptions: {
            shouldDehydrateQuery: (q) => q.state.status === 'success' && isPersisted(q.queryKey),
            shouldDehydrateMutation: () => false,
          },
        });
      });
    current = {
      identity,
      ready,
      stop: () => {
        stopped = true;
        unsubscribe?.();
        persister.dispose();
      },
    };
  };
  follow();
  return session.subscribe(follow);
}

/** Resolves once the signed-in person's saved copy is in the cache (at once when there is none). */
export function persistedCacheReady(): Promise<void> {
  return current?.ready ?? Promise.resolve();
}
