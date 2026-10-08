import { session, useClaims, usePlatformMe } from '@freefounders/core';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '@/components/common/page';

/**
 * Every page behind sign-in. A fresh page has no token in memory yet: renew it from the refresh cookie first.
 * Signed out → /login?next=<here>. Must change the password (admin-set) → /account first.
 */
export function RequireSession() {
  const claims = useClaims();
  const loc = useLocation();
  const [checked, setChecked] = useState(() => session.signedIn());
  useEffect(() => {
    if (session.signedIn()) return;
    void session.refresh().finally(() => setChecked(true));
  }, []);
  const me = usePlatformMe();

  if (!checked) return <PageLoader />;
  const here = loc.pathname + loc.search;
  if (!claims) return <Navigate to={`/login${here !== '/' ? `?next=${encodeURIComponent(here)}` : ''}`} replace />;
  if (me.data?.mustChangePassword && loc.pathname !== '/account') {
    return <Navigate to={`/account?first=1&next=${encodeURIComponent(here)}`} replace />;
  }
  return <Outlet />;
}

/** Only go back to a path on this site (never to another site through ?next=). */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return null;
  return next;
}
