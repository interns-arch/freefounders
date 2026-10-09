import { useAccess } from '@freefounders/core';
import { ensureAssetsCookie } from '@freefounders/core/assets';
import { ArrowLeft, LayoutGrid, Menu } from 'lucide-react';
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
    for (const v of ['--primary', '--ring', '--brand-2']) {
      if (colour) root.setProperty(v, colour);
      else root.removeProperty(v);
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
  const itemClass =
    'relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[14px] font-medium text-sidebar-foreground/80 transition-colors outline-none hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-2/60 [&_svg]:text-sidebar-foreground/55';
  const sidebar = (
    // The old app's sidebar: a soft top-to-bottom gradient on the forest green.
    <div className="flex h-full flex-col gap-2.5 bg-gradient-to-b from-white/[0.035] to-transparent px-3.5 pt-4 pb-3">
      <Link to="/?choose" className="rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-2/60" aria-label="Choose workspace">
        <Logo company={access.brand} subtitle={WORKSPACE_NAMES[here]} onDark />
      </Link>
      {workspaces.length > 1 && (
        <nav aria-label="Workspaces" className="grid grid-cols-2 gap-1 rounded-xl border border-sidebar-border/70 bg-black/20 p-1">
          {workspaces.map((w) => (
            <Link
              key={w}
              to={WORKSPACE_HOME[w]}
              aria-current={w === here ? 'page' : undefined}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold text-sidebar-foreground/70 transition outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-brand-2/60',
                w === here && 'bg-gradient-to-b from-brand-2 to-primary text-primary-foreground shadow-sm shadow-black/25',
              )}
            >
              {w !== here && <span className={cn('size-1.5 shrink-0 rounded-full', WORKSPACE_LOOK[w].dot)} aria-hidden />}
              {WORKSPACE_NAMES[w]}
            </Link>
          ))}
        </nav>
      )}
      <nav aria-label={`${WORKSPACE_NAMES[here]} menu`} className="no-scrollbar -mx-1 flex-1 space-y-0.5 overflow-y-auto px-1 pt-1">
        {items.map((item, i) => {
          const heading = item.group && item.group !== items[i - 1]?.group;
          const inner = (
            <>
              <item.icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate">{item.label}</span>
            </>
          );
          return (
            <div key={item.to}>
              {heading && (
                <p className="flex items-center gap-2 px-3 pt-3 pb-1 font-mono text-[10px] font-semibold tracking-widest text-sidebar-foreground/45 uppercase">
                  {item.group}
                  <span aria-hidden className="h-px flex-1 bg-sidebar-border/60" />
                </p>
              )}
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(itemClass, isActive && 'bg-gradient-to-r from-brand-2/22 to-brand-2/5 font-semibold text-white shadow-[inset_3px_0_0_0_var(--brand-2)] [&_svg]:text-brand-2')
                }
              >
                {inner}
              </NavLink>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border/70 pt-3">
        <UserMenu access={access} />
      </div>
    </div>
  );

  // Phones: the first four menu entries stay one tap away; "More" opens the full menu.
  const quick = items.slice(0, 4);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 border-r border-sidebar-border bg-sidebar lg:block">{sidebar}</aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 [&>button]:text-sidebar-foreground [&>button]:hover:bg-white/10">
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
            className="hidden items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase transition hover:bg-accent hover:text-primary lg:inline-flex"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Workspace portal
          </Link>
          <span className="hidden text-border lg:inline" aria-hidden>
            /
          </span>
          <span className="flex min-w-0 items-center gap-2 rounded-full border bg-background/60 py-1 pr-3 pl-1 text-[13px] font-semibold">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', look.soft)} aria-hidden>
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
          className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-card-lg backdrop-blur lg:hidden"
        >
          {quick.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn('group flex flex-col items-center gap-0.5 px-1 pt-1.5 pb-2 text-[11px] text-muted-foreground', isActive && 'font-semibold text-primary')
              }
            >
              <span className="rounded-full px-3 py-0.5 transition-colors group-aria-[current=page]:bg-accent">
                <item.icon className="size-5" aria-hidden />
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 px-1 pt-1.5 pb-2 text-[11px] text-muted-foreground">
            <span className="rounded-full px-3 py-0.5">
              <LayoutGrid className="size-5" aria-hidden />
            </span>
            More
          </button>
        </nav>
      </div>
    </div>
  );
}
