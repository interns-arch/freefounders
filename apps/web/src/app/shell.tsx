import { useAccess } from '@freefounders/core';
import { ensureAssetsCookie } from '@freefounders/core/assets';
import { ChevronDown, Home, LayoutGrid, Menu } from 'lucide-react';
import { type RefObject, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Sheet, SheetContent, SheetTitle } from '@/components/ui/overlays';
import { useHotkeys } from '@/lib/hotkeys';
import { cn } from '@/lib/utils';
import { ADMIN_NAV } from '@/features/admin/nav';
import { ASSETS_NAV } from '@/features/assets/nav';
import { ATTENDANCE_NAV } from '@/features/hr/nav';
import { TASKS_NAV } from '@/features/tasks/nav';
import { isWorkspace, type NavItem, type Workspace, WORKSPACE_HOME, WORKSPACE_NAMES, workspaceOf } from './nav';
import { Logo, NotificationsBell, ThemeToggle, UserMenu } from './shell-parts';
import { WORKSPACE_LOOK, workspacesFor } from './workspaces';

const MENUS: Record<Workspace, NavItem[]> = { attendance: ATTENDANCE_NAV, tasks: TASKS_NAV, assets: ASSETS_NAV, admin: ADMIN_NAV };

/**
 * Which groups are open in the sidebar. On an area's page only that group is open (the others show just their header);
 * on Home the groups remembered on this device are open, Attendance on the first visit (marking attendance comes first).
 */
const OPEN_KEY = 'ff-nav-open';
function readOpen(): Workspace[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null');
    if (Array.isArray(v)) return v.filter(isWorkspace);
  } catch {
    /* private mode or nothing saved */
  }
  return ['attendance'];
}
function saveOpen(open: Workspace[]) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {
    /* ignore */
  }
}

/** Alt+1..4 jump to Home / Attendance / Tasks / Assets (PLAN.md §19.14). */
const JUMPS: Array<{ n: number; label: string; to: string; w: Workspace | null }> = [
  { n: 1, label: 'Home', to: '/?home=1', w: null },
  { n: 2, label: 'Attendance', to: '/attendance', w: 'attendance' },
  { n: 3, label: 'Tasks', to: '/tasks', w: 'tasks' },
  { n: 4, label: 'Assets', to: '/assets', w: 'assets' },
];

/** The brand colour (Settings Center) replaces the primary colour everywhere. */
export function useBrandColour(colour: string | null | undefined) {
  useEffect(() => {
    const root = document.documentElement.style;
    for (const v of ['--primary', '--ring', '--brand-2']) {
      if (colour) root.setProperty(v, colour);
      else root.removeProperty(v);
    }
  }, [colour]);
}

/**
 * After a route change, move focus to the new page's main heading so screen readers announce the page and keyboard
 * users start at the top. Screens that place focus themselves (a search field) are left alone. Lazy pages arrive a
 * moment later: watch the main area until the heading is there.
 */
function useFocusHeading(pathname: string, main: RefObject<HTMLElement | null>) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = main.current;
    if (!root) return;
    const tryFocus = () => {
      const active = document.activeElement;
      if (active && active !== document.body && root.contains(active)) return true;
      const h = root.querySelector<HTMLElement>('h1');
      if (!h) return false;
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
      return true;
    };
    if (tryFocus()) return;
    const obs = new MutationObserver(() => {
      if (tryFocus()) obs.disconnect();
    });
    obs.observe(root, { childList: true, subtree: true });
    const stop = setTimeout(() => obs.disconnect(), 3000);
    return () => {
      obs.disconnect();
      clearTimeout(stop);
    };
  }, [pathname, main]);
}

/**
 * The frame around every screen (PLAN.md §19.14): one menu for the whole product. Desktop: a sidebar with Home and a
 * collapsible group per area (Attendance, Tasks, Assets, Admin). Phones: a bottom bar (Attendance · Home · Tasks · Assets ·
 * More) and the same menu in a drawer. The header carries the page area, light/dark, notifications and the account menu.
 */
export function AppShell() {
  const access = useAccess();
  const loc = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [homeOpen, setHomeOpen] = useState<Workspace[]>(readOpen);
  const [extra, setExtra] = useState<Workspace[]>([]);
  const here = workspaceOf(loc.pathname);
  const open = here ? extra : homeOpen;
  const look = here ? WORKSPACE_LOOK[here] : null;
  const title = here ? WORKSPACE_NAMES[here] : 'Home';

  // Close the phone drawer after following a link; in an area, only that area's group stays open.
  useEffect(() => {
    setDrawer(false);
    setExtra([]);
  }, [loc.pathname]);

  useBrandColour(access.brand?.colour);
  useFocusHeading(loc.pathname, mainRef);

  // Assets photos load with plain <img> tags: they need the Assets session cookie.
  const assetsOn = access.assets.on;
  useEffect(() => {
    if (assetsOn) void ensureAssetsCookie();
  }, [assetsOn, access.claims?.sub]);

  useEffect(() => {
    const short = access.brand?.shortName;
    document.title = short ? `${short} · ${title}` : `FreeFounders · ${title}`;
  }, [access.brand?.shortName, title]);

  const workspaces = useMemo(() => workspacesFor(access.apps, access.isAdmin), [access.apps, access.isAdmin]);

  // A group this person cannot open: back to Home.
  useEffect(() => {
    if (access.ready && here && !workspaces.includes(here)) navigate('/?home=1', { replace: true });
  }, [access.ready, workspaces, here, navigate]);

  const jumps = JUMPS.filter((j) => !j.w || workspaces.includes(j.w));

  // Alt+1..4 (by key position, so it works on every keyboard layout) and "?" for the shortcuts; Assets has its own "?".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const m = /^Digit([1-4])$/.exec(e.code);
      if (!m) return;
      const j = jumps.find((x) => x.n === Number(m[1]));
      if (!j) return;
      e.preventDefault();
      navigate(j.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jumps, navigate]);
  useHotkeys({ '?': () => setHelp(true) }, [], { enabled: here !== 'assets' });

  const toggle = (w: Workspace) => {
    const flip = (cur: Workspace[]) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w]);
    if (here) setExtra(flip);
    else
      setHomeOpen((cur) => {
        const next = flip(cur);
        saveOpen(next);
        return next;
      });
  };

  const groups = workspaces.map((w) => ({ w, items: MENUS[w].filter((i) => !i.show || i.show(access)) }));

  const itemClass =
    'relative flex min-h-11 items-center gap-2.5 rounded-md px-3 py-1.5 text-[14px] font-medium text-sidebar-foreground/80 transition-colors outline-none hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-2/60 lg:min-h-8 [&_svg]:text-sidebar-foreground/55';
  const activeClass = 'bg-gradient-to-r from-brand-2/22 to-brand-2/5 font-semibold text-white shadow-[inset_3px_0_0_0_var(--brand-2)] [&_svg]:text-brand-2';

  const sidebar = (
    <div className="flex h-full flex-col gap-2 bg-gradient-to-b from-white/[0.035] to-transparent px-3.5 pt-4 pb-3">
      <Link to="/?home=1" className="rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-2/60" aria-label="Home">
        <Logo company={access.brand} subtitle={access.platform?.company.name !== access.brand?.shortName ? access.platform?.company.name : undefined} onDark />
      </Link>
      <nav aria-label="Main menu" className="no-scrollbar -mx-1 flex-1 space-y-1 overflow-y-auto px-1 pt-1">
        <NavLink to="/?home=1" end className={({ isActive }) => cn(itemClass, isActive && activeClass)}>
          <Home className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">Home</span>
        </NavLink>
        {groups.map(({ w, items }) => {
          const expanded = w === here || open.includes(w);
          const gl = WORKSPACE_LOOK[w];
          return (
            <div key={w} className="pt-1.5">
              <div className="flex items-center gap-0.5">
                <Link
                  to={WORKSPACE_HOME[w]}
                  aria-current={w === here ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 flex-1 items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-bold tracking-wide outline-none transition-colors hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-2/60 lg:min-h-8',
                    w === here ? 'text-white' : 'text-sidebar-foreground/75',
                  )}
                >
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded-md', gl.solid)} aria-hidden>
                    <gl.icon className="size-3" />
                  </span>
                  <span className="flex-1 truncate">{WORKSPACE_NAMES[w]}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => toggle(w)}
                  disabled={w === here}
                  aria-expanded={expanded}
                  aria-controls={`menu-${w}`}
                  aria-label={expanded ? `Hide ${WORKSPACE_NAMES[w]} menu` : `Show ${WORKSPACE_NAMES[w]} menu`}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md text-sidebar-foreground/55 outline-none transition hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-2/60 disabled:cursor-default disabled:opacity-40 lg:size-8"
                >
                  <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
              </div>
              {expanded && (
                <nav id={`menu-${w}`} aria-label={`${WORKSPACE_NAMES[w]} menu`} className="mt-0.5 space-y-0.5 border-l border-sidebar-border/60 pl-2 ml-[18px]">
                  {items.map((item, i) => {
                    const heading = item.group && item.group !== items[i - 1]?.group;
                    return (
                      <div key={item.to}>
                        {heading && (
                          <p className="flex items-center gap-2 px-3 pt-2.5 pb-1 font-mono text-[10px] font-semibold tracking-widest text-sidebar-foreground/45 uppercase">
                            {item.group}
                            <span aria-hidden className="h-px flex-1 bg-sidebar-border/60" />
                          </p>
                        )}
                        <NavLink to={item.to} end={item.end} className={({ isActive }) => cn(itemClass, isActive && activeClass)}>
                          <item.icon className="size-4 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">{item.label}</span>
                        </NavLink>
                      </div>
                    );
                  })}
                </nav>
              )}
            </div>
          );
        })}
      </nav>
      <p className="hidden px-3 font-mono text-[10.5px] text-sidebar-foreground/40 lg:block">
        <button type="button" className="cursor-pointer rounded hover:text-white focus-visible:ring-2 focus-visible:ring-brand-2/60 focus-visible:outline-none" onClick={() => setHelp(true)}>
          Press ? for shortcuts
        </button>
      </p>
    </div>
  );

  // Phones: Attendance first (marking attendance is the priority), then Home, Tasks, Assets; Admin lives in More.
  const tabs: Array<{ to: string; label: string; icon: typeof Home; active: boolean }> = [
    ...(workspaces.includes('attendance') ? [{ to: '/attendance', label: 'Attendance', icon: WORKSPACE_LOOK.attendance.icon, active: here === 'attendance' }] : []),
    { to: '/?home=1', label: 'Home', icon: Home, active: here === null },
    ...(workspaces.includes('tasks') ? [{ to: '/tasks', label: 'Tasks', icon: WORKSPACE_LOOK.tasks.icon, active: here === 'tasks' }] : []),
    ...(workspaces.includes('assets') ? [{ to: '/assets', label: 'Assets', icon: WORKSPACE_LOOK.assets.icon, active: here === 'assets' }] : []),
  ];
  const tabClass = 'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-2 text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset';

  return (
    <div className="flex min-h-dvh">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 border-r border-sidebar-border bg-sidebar lg:block">{sidebar}</aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-[300px] border-sidebar-border bg-sidebar p-0 [&>button]:text-sidebar-foreground [&>button]:hover:bg-white/10">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-1.5 border-b bg-card/85 px-2 backdrop-blur sm:gap-2 sm:px-3 lg:px-6">
          <Button variant="ghost" size="icon" className="size-11 lg:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
            <Menu className="size-5" />
          </Button>
          <span className="flex min-w-0 items-center gap-2 rounded-full border bg-background/60 py-1 pr-3 pl-1 text-[13px] font-semibold">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', look ? look.soft : 'bg-primary/10 text-primary')} aria-hidden>
              {look ? <look.icon className="size-3.5" /> : <Home className="size-3.5" />}
            </span>
            <span className="truncate">{title}</span>
          </span>
          <div className="flex-1" />
          <ThemeToggle />
          <NotificationsBell />
          <UserMenu access={access} onShortcuts={() => setHelp(true)} />
        </header>
        <main id="content" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-24 outline-none lg:p-6 lg:pb-8 [&_h1:focus]:outline-none">
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
          {tabs.map((t) => (
            <Link key={t.label} to={t.to} aria-current={t.active ? 'page' : undefined} className={cn(tabClass, t.active && 'font-semibold text-primary')}>
              <span className={cn('rounded-full px-3 py-0.5 transition-colors', t.active && 'bg-accent')}>
                <t.icon className="size-5" aria-hidden />
              </span>
              <span className="max-w-full truncate">{t.label}</span>
            </Link>
          ))}
          <button type="button" onClick={() => setDrawer(true)} className={cn(tabClass, 'cursor-pointer')}>
            <span className="rounded-full px-3 py-0.5">
              <LayoutGrid className="size-5" aria-hidden />
            </span>
            More
          </button>
        </nav>
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Work without the mouse. Inside Assets, press ? for its own list (search, quick add, G-then-letter jumps).</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
            {jumps.map((j) => (
              <ShortcutRow key={j.n} keys={['Alt', String(j.n)]} what={`Go to ${j.label}`} />
            ))}
            <ShortcutRow keys={['1', '2', '3']} what="On Home: open Attendance, Tasks, Assets" />
            <ShortcutRow keys={['Tab']} what="Move between links and fields (the first Tab reveals “Skip to content”)" />
            <ShortcutRow keys={['?']} what="This list" />
            <ShortcutRow keys={['Esc']} what="Close dialogs and menus" />
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortcutRow({ keys, what }: { keys: string[]; what: string }) {
  return (
    <>
      <dt className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={k} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">{keys[0] === 'Alt' ? '+' : '/'}</span>}
            <Kbd className="h-6 min-w-6 text-[12px]">{k}</Kbd>
          </span>
        ))}
      </dt>
      <dd className="text-muted-foreground">{what}</dd>
    </>
  );
}
