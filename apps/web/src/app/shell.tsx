import { useAccess } from '@freefounders/core';
import { ensureAssetsCookie } from '@freefounders/core/assets';
import { ExternalLink, Menu } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import { ADMIN_NAV } from '@/features/admin/nav';
import { ASSETS_NAV } from '@/features/assets/nav';
import { HR_NAV } from '@/features/hr/nav';
import { TASKS_NAV } from '@/features/tasks/nav';
import { type NavItem, type Workspace, WORKSPACE_HOME, WORKSPACE_NAMES, workspaceOf } from './nav';
import { Logo, NotificationsBell, UserMenu } from './shell-parts';

const MENUS: Record<Workspace, NavItem[]> = { tasks: [...TASKS_NAV, ...HR_NAV], assets: ASSETS_NAV, admin: ADMIN_NAV };
const DOT: Record<Workspace, string> = { tasks: 'bg-app-tasks', assets: 'bg-app-assets', admin: 'bg-app-admin' };

/** The frame around every screen: sidebar with the workspace's menu, top bar with notifications. */
export function AppShell() {
  const access = useAccess();
  const loc = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const here = workspaceOf(loc.pathname) ?? 'tasks';

  // Close the phone drawer after following a link.
  useEffect(() => setDrawer(false), [loc.pathname]);

  // The company's brand colour (Settings Center) replaces the primary colour.
  const colour = access.brand?.colour ?? null;
  useEffect(() => {
    const root = document.documentElement.style;
    if (colour) {
      root.setProperty('--primary', colour);
      root.setProperty('--ring', colour);
    } else {
      root.removeProperty('--primary');
      root.removeProperty('--ring');
    }
  }, [colour]);

  // Assets photos load with plain <img> tags: they need the Assets session cookie.
  const assetsOn = access.assets.on;
  useEffect(() => {
    if (assetsOn) void ensureAssetsCookie();
  }, [assetsOn, access.claims?.sub]);

  useEffect(() => {
    const short = access.brand?.shortName;
    document.title = short ? `${short} · ${WORKSPACE_NAMES[here]}` : `FreeFounders · ${WORKSPACE_NAMES[here]}`;
  }, [access.brand?.shortName, here]);

  const workspaces = useMemo(() => {
    const list: Workspace[] = [...access.apps];
    if (access.isAdmin) list.push('admin');
    return list;
  }, [access.apps, access.isAdmin]);

  // A workspace this person cannot open: back to the chooser.
  useEffect(() => {
    if (access.ready && !workspaces.includes(here)) navigate('/?choose', { replace: true });
  }, [access.ready, workspaces, here, navigate]);

  const items = MENUS[here].filter((i) => !i.show || i.show(access));
  const sidebar = (
    <div className="flex h-full flex-col gap-3 p-3">
      <Link to="/?choose" className="rounded-lg px-1 py-1.5" aria-label="Choose workspace">
        <Logo company={access.brand} />
      </Link>
      {workspaces.length > 1 && (
        <nav aria-label="Workspaces" className="grid grid-flow-col gap-1 rounded-lg bg-sidebar-accent/60 p-1">
          {workspaces.map((w) => (
            <Link
              key={w}
              to={WORKSPACE_HOME[w]}
              aria-current={w === here ? 'page' : undefined}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition',
                w === here && 'bg-card text-foreground shadow-xs',
              )}
            >
              <span className={cn('size-1.5 rounded-full', DOT[w])} aria-hidden />
              {WORKSPACE_NAMES[w]}
            </Link>
          ))}
        </nav>
      )}
      <nav aria-label={`${WORKSPACE_NAMES[here]} menu`} className="-mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
        {items.map((item, i) => {
          const heading = item.group && item.group !== items[i - 1]?.group;
          const inner = (
            <>
              <item.icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{item.label}</span>
              {item.classic && <ExternalLink className="size-3 opacity-50" aria-label="opens the classic screen" />}
            </>
          );
          const cls = 'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground transition hover:bg-sidebar-accent';
          return (
            <div key={item.to}>
              {heading && <p className="px-2.5 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{item.group}</p>}
              {item.classic ? (
                <a href={item.to} className={cls}>
                  {inner}
                </a>
              ) : (
                <NavLink to={item.to} end={item.end} className={({ isActive }) => cn(cls, isActive && 'bg-sidebar-accent font-medium text-foreground')}>
                  {inner}
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>
      <UserMenu access={access} />
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-sidebar lg:block">{sidebar}</aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
            <Menu className="size-5" />
          </Button>
          <span className="lg:hidden">
            <Logo company={access.brand} compact />
          </span>
          <div className="flex-1" />
          <NotificationsBell />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6">
          {access.ready ? (
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          ) : (
            <PageLoader />
          )}
        </main>
      </div>
    </div>
  );
}
