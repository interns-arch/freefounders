import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { PageLoader } from '@/components/common/page';

/** Classic address of a screen not moved yet: /tasks/leads → /classic/tasks/leads (PLAN.md §18.3). */
export function classicHref(pathname: string, search = '') {
  // An app's home needs its trailing slash (/classic/tasks/), like any app served under a base path.
  return `/classic${pathname}${/^\/(tasks|assets)$/.test(pathname) ? '/' : ''}${search}`;
}

/** A screen this app does not have yet: open it in the classic app (full page load, same sign-in). */
export function ClassicRedirect({ app }: { app: 'tasks' | 'assets' }) {
  const loc = useLocation();
  useEffect(() => {
    window.location.replace(classicHref(loc.pathname.startsWith(`/${app}`) ? loc.pathname : `/${app}`, loc.search));
  }, [app, loc.pathname, loc.search]);
  return <PageLoader />;
}
