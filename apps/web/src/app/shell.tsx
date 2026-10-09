import { useAccess } from '@freefounders/core';
import { ensureAssetsCookie } from '@freefounders/core/assets';
import { ArrowLeft, ExternalLink, LayoutGrid, Menu } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import { ADMIN_NAV } from '@/features/admin/nav';
import { ASSETS_NAV } from '@/features/assets/nav';
import { ATTENDANCE_NAV, HR_NAV } from '@/features/hr/nav';
import { TASKS_NAV } from '@/features/tasks/nav';
import { type NavItem, type Workspace, WORKSPACE_HOME, WORKSPACE_NAMES, workspaceOf } from './nav';
import { Logo, NotificationsBell, ThemeToggle, UserMenu } from './shell-parts';
import { WORKSPACE_LOOK, workspacesFor } from './workspaces';

const MENUS: Record<Workspace, NavItem[]> = {
  attendance: ATTENDANCE_NAV,
  tasks: [...TASKS_NAV, ...HR_NAV],
  assets: ASSETS_NAV,
  admin: ADMIN_NAV,
};

/** The brand colour (Settings Center) replaces the primary colour everywhere, the portal included. */
export function useBrandColour(colour: string | null | undefined) {
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
}

/** The frame around every screen (PLAN.md §19.5): sidebar with the workspace's menu, header, and on phones a bottom bar. */
export function AppShell() {
  const access = useAccess();
  const loc = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const here = workspaceOf(loc.pathname) ?? 'tasks';
  const look = WORKSPACE_LOOK[here];

  // Close the phone drawer after following a link.
  useEffect(() => setDrawer(false), [loc.pathname]);

  useBrandColour(access.brand?.colour);

  // Assets photos load with plain <img> tags: they need the Assets session cookie.
  const assetsOn = access.assets.on;
  useEffect(() => {
    if (assetsOn) void ensureAssetsCookie();
  }, [assetsOn, access.claims?.sub]);

  useEffect(() => {
    const short = access.brand?.shortName;
    document.title = short ? `${short} · ${WORKSPACE_NAMES[here]}` : `FreeFounders · ${WORKSPACE_NAMES[here]}`;
  }, [access.brand?.shortName, here]);

  const workspaces = useMemo(() => workspacesFor(access.apps, access.isAdmin), [access.apps, access.isAdmin]);

  // A workspace this person cannot open: back to the portal.
  useEffect(() => {
    if (access.ready && !workspaces.includes(here)) navigate('/?choose', { replace: true });
  }, [access.ready, workspaces, here, navigate]);

  const items = MENUS[here].filter((i) => !i.show || i.show(access));
  const itemClass = 'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition hover:bg-sidebar-accent/70';
  const sidebar = (
    <div className="flex h-full flex-col gap-3 p-3">
      <Link to="/?choose" className="rounded-lg px-1 py-1.5" aria-label="Choose workspace">
        <Logo company={access.brand} subtitle={WORKSPACE_NAMES[here]} />
      </Link>
      {workspaces.length > 1 && (
        <nav aria-label="Workspaces" className="grid grid-cols-2 gap-1 rounded-xl border bg-background p-1">
          {workspaces.map((w) => (
            <Link
              key={w}
              to={WORKSPACE_HOME[w]}
              aria-current={w === here ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground',
                w === here && 'bg-card text-foreground shadow-xs ring-1 ring-border',
              )}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', WORKSPACE_LOOK[w].dot)} aria-hidden />
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
          return (
            <div key={item.to}>
              {heading && <p className="px-2.5 pt-4 pb-1 font-mono text-[10px] font-medium tracking-widest text-muted-foreground/80 uppercase">{item.group}</p>}
              {item.classic ? (
                <a href={item.to} className={itemClass}>
                  {inner}
                </a>
              ) : (
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cn(itemClass, isActive && 'bg-sidebar-accent font-medium text-primary [&_svg]:text-primary')}
                >
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

  // Phones: the first four menu entries stay one tap away; "More" opens the full menu.
  const quick = items.filter((i) => !i.classic).slice(0, 4);

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
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/85 px-3 backdrop-blur lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
            <Menu className="size-5" />
          </Button>
          <Link
            to="/?choose"
            className="hidden items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase transition hover:bg-accent hover:text-foreground lg:inline-flex"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Workspace portal
          </Link>
          <span className="hidden text-border lg:inline" aria-hidden>
            /
          </span>
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', look.soft)} aria-hidden>
              <look.icon className="size-3.5" />
            </span>
            <span className="truncate">{WORKSPACE_NAMES[here]}</span>
          </span>
          <div className="flex-1" />
          <ThemeToggle />
          <NotificationsBell />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-24 lg:p-6">
          {access.ready ? (
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          ) : (
            <PageLoader />
          )}
        </main>
        <nav
          aria-label="Quick menu"
          className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          {quick.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn('flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] text-muted-foreground', isActive && 'font-medium text-primary')
              }
            >
              <item.icon className="size-5" aria-hidden />
              <span className="max-w-full truncate">{item.label}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] text-muted-foreground">
            <LayoutGrid className="size-5" aria-hidden />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}
