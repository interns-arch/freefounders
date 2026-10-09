/**
 * Workspace Portal (PLAN.md §19.2): the first screen after sign-in. Built to be quick: one greeting line, punch in / out
 * right here (§19.3), one card per workspace that opens with a click anywhere on it (or the keys 1, 2, 3), and a short
 * admin row. Same URL as the old chooser (/ and /?choose); the same names the tests use.
 */
import { type Access, useAccess, useSignOut } from '@freefounders/core';
import { useAssetsDashboard } from '@freefounders/core/assets';
import { nearestOffice, useHrConfig, useLeaveBalances, useOfficeLocations, usePendingCorrections, usePendingLeaves } from '@freefounders/core/hr';
import { useMyTaskTiles, useWaitingCounts } from '@freefounders/core/tasks';
import { ArrowRight, Camera, Fingerprint, Home, KeyRound, LogIn, LogOut, MapPin, ScanFace, ScanLine, Settings2, ShieldCheck, Users } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Avatar, Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { hrs } from '@/features/hr/parts';
import { usePunch } from '@/features/hr/punch';
import { currentPosition } from '@/features/hr/face';
import { type Workspace, WORKSPACE_HOME, WORKSPACE_NAMES } from '../nav';
import { safeNext } from '../session-guard';
import { Logo, NotificationsBell, ThemeToggle } from '../shell-parts';
import { useBrandColour } from '../shell';
import { WORKSPACE_LOOK, workspacesFor } from '../workspaces';

const REMEMBER = 'ff-workspace';

function remembered(): Workspace | null {
  try {
    const v = localStorage.getItem(REMEMBER);
    return v === 'attendance' || v === 'tasks' || v === 'assets' ? v : null;
  } catch {
    return null;
  }
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const ampm = (hhmm: string | undefined) => {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

/** The time to the minute (no per-second re-renders). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Where the person is, only if they already allowed location for this site (no prompt on page open, §19.3). */
function useKnownPosition(wanted: boolean) {
  const [pos, setPos] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    if (!wanted || typeof navigator === 'undefined' || !navigator.permissions) return;
    let gone = false;
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then(async (s) => {
        if (s.state !== 'granted') return;
        const p = await currentPosition();
        if (!gone && p.latitude != null && p.longitude != null) setPos({ latitude: p.latitude, longitude: p.longitude });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [wanted]);
  return pos;
}

const TITLES: Record<Exclude<Workspace, 'admin'>, string> = { attendance: 'Attendance & Shifts', tasks: 'Tasks & Automations', assets: 'Assets & Inventory' };

export function ChooserPage() {
  const access = useAccess();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [keep, setKeep] = useState(() => !!remembered());
  const next = safeNext(params.get('next'));
  const choosing = params.has('choose');
  useBrandColour(access.brand?.colour);

  useEffect(() => {
    if (access.platform && next) navigate(next, { replace: true });
  }, [access.platform, next, navigate]);

  useEffect(() => {
    const short = access.brand?.shortName;
    document.title = short ? `${short} · Workspaces` : 'FreeFounders · Workspaces';
  }, [access.brand?.shortName]);

  const workspaces = access.platform ? workspacesFor(access.apps, access.isAdmin) : [];
  const cards = workspaces.filter((w): w is Exclude<Workspace, 'admin'> => w !== 'admin');

  const open = (w: Workspace, to = WORKSPACE_HOME[w]) => {
    try {
      if (keep && w !== 'admin') localStorage.setItem(REMEMBER, w);
      else if (!keep) localStorage.removeItem(REMEMBER);
    } catch {
      /* private mode: fine */
    }
    navigate(to);
  };

  // Keys 1, 2, 3 open the workspaces in the order shown (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= cards.length) {
        e.preventDefault();
        open(cards[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.join(','), keep]);

  if (!access.platform) return <PageLoader />;
  if (!choosing && !next) {
    const saved = remembered();
    if (saved && workspaces.includes(saved)) return <Navigate to={WORKSPACE_HOME[saved]} replace />;
    // Only Assets (no attendance to mark here, no admin row): straight in.
    if (workspaces.length === 1 && workspaces[0] === 'assets') return <Navigate to="/assets" replace />;
  }

  const person = access.platform.person;
  const first = person.fullName.split(' ')[0];
  const tasksOn = access.apps.includes('tasks');
  const level = person.role === 'owner' ? 'Super Admin' : person.role === 'admin' ? 'Admin' : 'Member';

  return (
    <div className="min-h-dvh bg-background pb-24 sm:pb-8">
      <a
        href="#workspaces"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to workspaces
      </a>
      <PortalHeader access={access} level={level} />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {/* One line: who, when, and today's attendance at a glance. */}
        <section aria-label="Today" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">
              {greeting()}, {first}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {today()}
              {person.role !== 'member' && <> · {level}</>}
            </p>
          </div>
          {tasksOn && <TodayStrip />}
        </section>

        {access.apps.length === 0 && (
          <p role="status" className="rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
            You don’t have access to any app yet. {access.isAdmin ? 'Give yourself a role under People & access.' : 'Ask your company admin for access.'}
          </p>
        )}

        {cards.length > 0 && (
          <section aria-labelledby="choose-title" id="workspaces" className="scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="choose-title" className="text-base font-bold tracking-tight">
                Choose your workspace
                <span className="ml-2 hidden font-mono text-[11px] font-medium text-muted-foreground sm:inline">press 1 · 2 · 3</span>
              </h2>
              {cards.length > 1 && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
                  <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} aria-label="Remember my choice on this device" />
                  Remember my choice on this device
                </label>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((w, i) =>
                w === 'attendance' ? (
                  <AttendanceCard key={w} index={i + 1} onOpen={(to) => open('attendance', to)} />
                ) : w === 'tasks' ? (
                  <TasksCard key={w} index={i + 1} onOpen={(to) => open('tasks', to)} />
                ) : (
                  <AssetsCard key={w} index={i + 1} access={access} onOpen={(to) => open('assets', to)} />
                ),
              )}
            </div>
          </section>
        )}

        {access.isAdmin && <AdminRow onOpen={(to) => navigate(to)} />}
      </main>
      <PortalBottomBar workspaces={workspaces} />
    </div>
  );
}

function PortalHeader({ access, level }: { access: Access; level: string }) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const name = access.platform?.person.fullName ?? '';
  return (
    <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Logo company={access.brand} subtitle={access.platform?.company.name !== access.brand?.shortName ? access.platform?.company.name : undefined} />
        <div className="flex-1" />
        <ThemeToggle />
        <NotificationsBell />
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <span className="hidden text-right leading-tight md:block">
          <span className="block text-sm font-semibold">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{level}</span>
        </span>
        <Avatar name={name} className="size-9" />
        <Button variant="ghost" size="sm" onClick={() => navigate('/account')} aria-label="Change password" title="Change password">
          <KeyRound /> <span className="hidden lg:inline">Change password</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login') })}>
          <LogOut /> <span className="hidden sm:inline">Sign out</span>
          <span className="sr-only sm:hidden">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

/** Shift hours, the time now, and anything that will matter at the punch (outside the office, face not set up). */
function TodayStrip() {
  const cfg = useHrConfig();
  const p = usePunch();
  const offices = useOfficeLocations();
  const now = useNow();
  const known = useKnownPosition(!!p.data?.geofence_enabled);
  const pos = p.position ?? known;
  const near = pos && offices.data ? nearestOffice(pos, offices.data) : null;
  const d = p.data;
  const warnings: Array<{ icon: typeof MapPin; text: string }> = [];
  if (d?.geofence_enabled && near && !near.inside) warnings.push({ icon: MapPin, text: `${near.metres} m from ${near.office.name}` });
  if (d?.face_enabled && !d.face_enrolled && !d.face_self_enroll) warnings.push({ icon: ScanFace, text: 'Face not enrolled — ask an admin' });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="text-muted-foreground">
        Shift <span className="font-mono font-semibold text-foreground">{cfg.data ? `${ampm(cfg.data.work_start)} – ${ampm(cfg.data.work_end)}` : '—'}</span>
      </span>
      <span className="text-muted-foreground">
        Now{' '}
        <span className="font-mono font-semibold text-foreground tabular-nums" aria-label="Current time">
          {clock(now)}
        </span>
      </span>
      {d?.geofence_enabled && near?.inside && (
        <span className="inline-flex items-center gap-1 text-success">
          <MapPin className="size-3.5" aria-hidden /> At {near.office.name}
        </span>
      )}
      {d?.photo === 'required' && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Camera className="size-3.5" aria-hidden /> Selfie at punch
        </span>
      )}
      {warnings.map((w) => (
        <span key={w.text} className="inline-flex items-center gap-1 font-medium text-warning">
          <w.icon className="size-3.5" aria-hidden /> {w.text}
        </span>
      ))}
    </div>
  );
}

/**
 * A workspace card. The whole card opens the workspace (click, Enter or the number key); buttons inside it do their own
 * thing. One region per card, named by its title (the tests find "Attendance & Shifts" this way).
 */
function WorkspaceCard({
  w,
  index,
  badge,
  children,
  action,
  onOpen,
}: {
  w: Exclude<Workspace, 'admin'>;
  index: number;
  badge?: ReactNode;
  children: ReactNode;
  action: ReactNode;
  onOpen: () => void;
}) {
  const look = WORKSPACE_LOOK[w];
  const openIfCard = (e: React.MouseEvent) => {
    // Clicks on buttons, links, inputs inside the card are theirs.
    if ((e.target as HTMLElement).closest('button, a, input, label, [role=dialog]')) return;
    onOpen();
  };
  return (
    <section
      aria-labelledby={`card-${w}`}
      onClick={openIfCard}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card shadow-card transition-shadow hover:shadow-card-lg focus-within:ring-2 focus-within:ring-ring/40"
    >
      <div aria-hidden className={cn('absolute inset-x-0 top-0 h-1', look.dot)} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', look.solid)} aria-hidden>
            <look.icon className="size-[22px]" />
          </span>
          <h3 id={`card-${w}`} className="min-w-0 flex-1 text-[17px] leading-tight font-bold tracking-tight">
            <button type="button" onClick={onOpen} className="cursor-pointer text-left outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary">
              {TITLES[w]}
            </button>
          </h3>
          <kbd className="hidden rounded-md border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground sm:inline" aria-hidden>
            {index}
          </kbd>
        </div>
        {badge}
        <div className="relative z-10 flex-1 space-y-3">{children}</div>
        <div className="relative z-10 space-y-2">{action}</div>
      </div>
    </section>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap',
        tone === 'ok' && 'border-success/30 bg-success/10 text-success',
        tone === 'warn' && 'border-warning/40 bg-warning/12 text-warning',
        tone === 'bad' && 'border-destructive/30 bg-destructive/10 text-destructive',
        tone === 'info' && 'border-primary/25 bg-primary/10 text-primary',
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {children}
    </span>
  );
}

/** A number that opens its list. Big enough to tap; the label reads as one phrase ("24 overdue"). */
function Count({ label, value, alert, to, small }: { label: string; value: number | string | undefined; alert?: boolean; to?: string; small?: boolean }) {
  const body = (
    <>
      <span className={cn('block font-mono leading-tight font-bold whitespace-nowrap tabular-nums', small ? 'text-[17px]' : 'text-[22px]', alert && value ? 'text-destructive' : '')}>
        {value ?? '—'}
      </span>
      <span className="mt-0.5 block text-[12px] text-muted-foreground">{label}</span>
    </>
  );
  const cls = cn('block rounded-lg border bg-background/60 px-2 py-2 text-center', alert && value ? 'border-destructive/30 bg-destructive/6' : '');
  return to ? (
    <Link
      to={to}
      aria-label={`${value ?? '—'} ${label}`}
      className={cn(cls, 'transition outline-none hover:border-primary/50 hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40')}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function AttendanceCard({ index, onOpen }: { index: number; onOpen: (to?: string) => void }) {
  const p = usePunch();
  const cfg = useHrConfig();
  const balances = useLeaveBalances();
  const approves = !!cfg.data?.can_approve;
  const leaves = usePendingLeaves(approves);
  const corrections = usePendingCorrections(approves);
  const d = p.data;
  const a = d?.attendance;
  const pending = (leaves.data?.length ?? 0) + (corrections.data?.length ?? 0);

  const state = !d
    ? null
    : d.can_check_in
      ? 'in'
      : d.can_check_out
        ? 'out'
        : a?.check_in
          ? 'done'
          : 'none';
  const badge = !d ? (
    <Skeleton className="h-6 w-32" />
  ) : a?.check_in && !a.check_out ? (
    <Pill tone="ok">Checked in {timeOf(a.check_in)}</Pill>
  ) : a?.check_out ? (
    <Pill tone="info">Done · {hrs(a.working_minutes)}</Pill>
  ) : a && a.status !== 'not_checked_in' ? (
    <Pill tone="info">{a.status_display}</Pill>
  ) : (
    <Pill tone="bad">Not checked in</Pill>
  );

  return (
    <WorkspaceCard
      w="attendance"
      index={index}
      badge={badge}
      onOpen={() => onOpen()}
      action={
        <>
          <div aria-live="polite">
            {p.err && (
              <p role="alert" className="mb-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {p.err}{' '}
                <button type="button" className="font-medium underline" onClick={() => onOpen('/attendance/history')}>
                  Request a correction
                </button>
              </p>
            )}
            {p.msg && (
              <p role="status" className="mb-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success">
                {p.msg}
              </p>
            )}
          </div>
          {state === 'in' || state === 'out' ? (
            <Button
              size="lg"
              className="h-12 w-full text-base"
              disabled={p.busy}
              loading={p.busy && !p.waitingForCamera}
              onClick={() => p.markIt(state === 'in' ? 'check_in' : 'check_out')}
            >
              {p.usesCamera ? <Fingerprint /> : state === 'in' ? <LogIn /> : <LogOut />}
              {state === 'in' ? 'Punch in' : 'Punch out'}
            </Button>
          ) : (
            <Button size="lg" variant="outline" className="h-12 w-full text-base" onClick={() => onOpen()}>
              {state === 'done' ? `Done for today · ${hrs(a?.working_minutes)}` : 'Open attendance'}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-between" onClick={() => onOpen()}>
            Open Attendance &amp; Leave
            {approves && pending > 0 ? <Pill tone="warn">{pending === 1 ? '1 approval' : `${pending} approvals`} pending</Pill> : <ArrowRight />}
          </Button>
          {p.camera}
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Count label="Checked in" value={timeOf(a?.check_in)} small />
        <Count label="Checked out" value={timeOf(a?.check_out)} small />
        <Count label="Worked" value={hrs(a?.working_minutes)} small />
      </div>
      {(balances.data?.length ?? 0) > 0 && (
        <p className="truncate text-[13px] text-muted-foreground">
          Leave left:{' '}
          {balances.data!.slice(0, 2).map((b, i) => (
            <span key={b.leave_type}>
              {i > 0 && ' · '}
              <span className="font-mono font-semibold text-foreground">{b.balance}</span> {b.name}
            </span>
          ))}
        </p>
      )}
    </WorkspaceCard>
  );
}

function TasksCard({ index, onOpen }: { index: number; onOpen: (to?: string) => void }) {
  const tiles = useMyTaskTiles();
  const waiting = useWaitingCounts();
  const t = tiles.data;
  return (
    <WorkspaceCard
      w="tasks"
      index={index}
      badge={!t ? <Skeleton className="h-6 w-24" /> : t.overdue > 0 ? <Pill tone="bad">{t.overdue} overdue</Pill> : <Pill tone="ok">On track</Pill>}
      onOpen={() => onOpen()}
      action={
        <>
          <Button size="lg" className="h-12 w-full text-base" onClick={() => onOpen()}>
            Open Tasks <ArrowRight />
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-between" onClick={() => onOpen('/tasks/tasks')}>
            My task list <ArrowRight />
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Count label="Active" value={t ? t.pending + t.in_progress : undefined} to="/tasks/tasks?tab=my" />
        <Count label="Overdue" value={t?.overdue} alert to="/tasks/tasks?tab=my&overdue=1" />
        <Count label="To accept" value={waiting.data?.accept} to="/tasks/tasks?tab=reviews" />
      </div>
      <p className="text-[13px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">{waiting.data?.requests ?? 0}</span> change requests to decide ·{' '}
        <span className="font-mono font-semibold text-foreground">{t?.completed ?? 0}</span> completed
      </p>
    </WorkspaceCard>
  );
}

function AssetsCard({ index, access, onOpen }: { index: number; access: Access; onOpen: (to?: string) => void }) {
  const dash = useAssetsDashboard();
  const d = dash.data;
  const canScan = access.assets.can('asset:view', 'asset:assign');
  return (
    <WorkspaceCard
      w="assets"
      index={index}
      badge={dash.error ? <Pill tone="warn">Unavailable right now</Pill> : !d ? <Skeleton className="h-6 w-24" /> : <Pill tone="ok">Up to date</Pill>}
      onOpen={() => onOpen()}
      action={
        <>
          <Button size="lg" className="h-12 w-full text-base" onClick={() => onOpen()}>
            Open Assets <ArrowRight />
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-between" onClick={() => onOpen(canScan ? '/assets/scan' : '/assets/requests')}>
            <span className="inline-flex items-center gap-2">
              {canScan && <ScanLine className="size-4" aria-hidden />}
              {canScan ? 'Scan QR / barcode' : 'Request an item'}
            </span>
            <ArrowRight />
          </Button>
        </>
      }
    >
      {!d ? (
        <Skeleton className="h-16" />
      ) : d.scope === 'organisation' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Count label="Assigned" value={d.totals.assigned} />
            <Count label="Exit items" value={d.totals.exitPendingItems} alert />
            <Count label="Open tickets" value={d.totals.openTickets} />
          </div>
          <p className="text-[13px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{d.totals.available}</span> available ·{' '}
            <span className="font-mono font-semibold text-foreground">{d.totals.pendingRequests}</span> requests waiting
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Count label="With me" value={d.myAssets.length} />
            <Count label="Exit hold" value={d.openExit ? 1 : 0} alert />
            <Count label="Tickets" value={d.tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length} />
          </div>
          {d.myAssets[0] && (
            <p className="truncate text-[13px] text-muted-foreground">
              {d.myAssets[0].name} · <span className="font-mono text-primary">{d.myAssets[0].assetTag}</span>
            </p>
          )}
        </>
      )}
    </WorkspaceCard>
  );
}

/** Admin: three plain buttons on one row (no extra requests on this page). */
function AdminRow({ onOpen }: { onOpen: (to: string) => void }) {
  const items = [
    { name: 'People & access', blurb: 'People, roles, passwords', to: '/people', icon: Users },
    { name: 'Roles', blurb: 'Permissions and duties', to: '/roles', icon: ShieldCheck },
    { name: 'Settings', blurb: 'Company, modules, departments', to: '/settings', icon: Settings2 },
  ];
  return (
    <section aria-labelledby="admin-title">
      <h2 id="admin-title" className="mb-3 text-base font-bold tracking-tight">
        Admin
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((x) => (
          <button
            key={x.to}
            type="button"
            onClick={() => onOpen(x.to)}
            className="group flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-card transition hover:border-primary/50 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-app-admin/12 text-app-admin" aria-hidden>
              <x.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold tracking-tight group-hover:text-primary">{x.name}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">{x.blurb}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

/** Phones (§19.2): Home plus each workspace one tap away. */
function PortalBottomBar({ workspaces }: { workspaces: Workspace[] }) {
  const items = [{ to: '/?choose', label: 'Home', icon: Home }, ...workspaces.map((w) => ({ to: WORKSPACE_HOME[w], label: WORKSPACE_NAMES[w], icon: WORKSPACE_LOOK[w].icon }))];
  return (
    <nav
      aria-label="Quick menu"
      className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-card-lg backdrop-blur sm:hidden"
    >
      {items.map((i, n) => (
        <Link key={i.to} to={i.to} className={cn('flex flex-col items-center gap-0.5 px-1 pt-1.5 pb-2 text-[11px] text-muted-foreground', n === 0 && 'font-semibold text-primary')}>
          <span className={cn('rounded-full px-3 py-0.5', n === 0 && 'bg-accent')}>
            <i.icon className="size-5" aria-hidden />
          </span>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
