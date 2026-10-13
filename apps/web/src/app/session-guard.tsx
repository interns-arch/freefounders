import { session, useClaims } from '@freefounders/core';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { persistedCacheReady } from './query-persist';

/**
 * Every page behind sign-in. A fresh page has no token in memory yet: renew it from the refresh cookie first.
 * Signed out → /login?next=<here>. Nobody is sent to change their password first (docs/security/platform.md R7):
 * they can change it any time from the account menu.
 */
export function RequireSession() {
  const claims = useClaims();
  const loc = useLocation();
  const [checked, setChecked] = useState(() => session.signedIn());
  useEffect(() => {
    if (session.signedIn()) return;
    // Signed in again: put this person's saved data in the cache first, so the first screen draws from it (§19.18).
    void session
      .refresh()
      .then((ok) => (ok ? persistedCacheReady() : undefined))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <PageLoader />;
  const here = loc.pathname + loc.search;
  if (!claims) return <Navigate to={`/login${here !== '/' ? `?next=${encodeURIComponent(here)}` : ''}`} replace />;
  return <Outlet />;
}

/** Only go back to a path on this site (never to another site through ?next=). */
export function safeNext(next: string | null): string | null {
  // Browsers read "/\evil.com" like "//evil.com"; a backslash or control character never belongs in our own paths.
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f]/.test(next) || next.startsWith('/login')) return null;
  return next;
}
