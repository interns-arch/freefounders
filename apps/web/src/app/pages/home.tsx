/**
 * Home (PLAN.md §19.14): the first screen after sign-in, inside the normal app frame. Attendance comes first: the
 * mark-attendance card (live clock, state, one big Punch in / Punch out button, the checks that matter at the punch,
 * today's times) sits right under the greeting; then Tasks and Assets with their live counts, then the admin shortcuts.
 * Same URL as the old chooser (/ and /?choose); on phones a person with Attendance lands on /attendance instead unless
 * the URL says ?home=1 (the bottom bar's Home tab).
 */
import { type Access, useAccess } from '@freefounders/core';
import { useAssetsDashboard } from '@freefounders/core/assets';
import { nearestOffice, useHrConfig, useLeaveBalances, useOfficeLocations, usePendingCorrections, usePendingLeaves } from '@freefounders/core/hr';
import { useMyTaskTiles, useWaitingCounts } from '@freefounders/core/tasks';
import { ADMIN_SCREENS } from '@/features/admin/nav';
import { ArrowRight, Camera, Fingerprint, LogIn, LogOut, MapPin, ScanLine, Settings2, ShieldCheck, Users } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { useMinuteClock } from '@/lib/lite';
import { cn } from '@/lib/utils';
import { hrs } from '@/features/hr/parts';
import { usePunch } from '@/features/hr/punch';
import { currentPosition } from '@/features/hr/device';
import { type Workspace, WORKSPACE_HOME } from '../nav';
import { safeNext } from '../session-guard';
import { WORKSPACE_LOOK, workspacesFor } from '../workspaces';

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

/** Phones: a person with Attendance lands on the full Today page (marking attendance is the priority on mobile). */
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

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

export function HomePage() {
  const access = useAccess();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [phone] = useState(isPhone);

  useEffect(() => {
    if (access.platform && next) navigate(next, { replace: true });
  }, [access.platform, next, navigate]);

  const workspaces = access.platform ? workspacesFor(access.apps, access.admin.any) : [];
  const cards = workspaces.filter((w): w is Exclude<Workspace, 'admin'> => w !== 'admin');

  // Keys 1, 2, 3 open the cards in the order shown (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= cards.length) {
        e.preventDefault();
        navigate(WORKSPACE_HOME[cards[n - 1]]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.join(',')]);

  if (!access.platform) return <PageLoader />;
  if (phone && !next && !params.has('home') && workspaces.includes('attendance')) return <Navigate to="/attendance" replace />;

  const person = access.platform.person;
  const first = person.fullName.split(' ')[0];
  const level = person.role === 'owner' ? 'Super Admin' : person.role === 'admin' ? 'Admin' : 'Member';
  const open = (to: string) => navigate(to);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">
          {greeting()}, {first}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {today()}
          {person.role !== 'member' && <> · {level}</>}
        </p>
      </div>

      {access.apps.length === 0 && (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
          You don’t have access to any app yet. {access.isAdmin ? 'Give yourself a role under People & access.' : 'Ask your company admin for access.'}
        </p>
      )}

      {cards.includes('attendance') && <AttendanceCard index={1} onOpen={(to = '/attendance') => open(to)} />}

      {cards.some((w) => w !== 'attendance') && (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((w, i) =>
            w === 'tasks' ? (
              <TasksCard key={w} index={i + 1} onOpen={(to = '/tasks') => open(to)} />
            ) : w === 'assets' ? (
              <AssetsCard key={w} index={i + 1} access={access} onOpen={(to = '/assets') => open(to)} />
            ) : null,
          )}
        </div>
      )}

      {access.admin.any && <AdminRow onOpen={open} />}
    </div>
  );
}

/** Shift hours and anything that will matter at the punch (outside the office, selfie). */
function Checks({ p }: { p: ReturnType<typeof usePunch> }) {
  const cfg = useHrConfig();
  const offices = useOfficeLocations();
  const known = useKnownPosition(!!p.data?.geofence_enabled);
  const pos = p.position ?? known;
  const near = pos && offices.data ? nearestOffice(pos, offices.data) : null;
  const d = p.data;
  const warnings: Array<{ icon: typeof MapPin; text: string }> = [];
  if (d?.geofence_enabled && near && !near.inside) warnings.push({ icon: MapPin, text: `${near.metres} m from ${near.office.name}` });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
      <span className="text-muted-foreground">
        Shift <span className="font-mono font-semibold text-foreground">{cfg.data ? `${ampm(cfg.data.work_start)} – ${ampm(cfg.data.work_end)}` : '—'}</span>
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

function CardTitle({ w, index, children }: { w: Exclude<Workspace, 'admin'>; index: number; children?: ReactNode }) {
  const look = WORKSPACE_LOOK[w];
  return (
    <div className="flex items-center gap-3">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', look.soft)} aria-hidden>
        <look.icon className="size-5" />
      </span>
      <h2 id={`card-${w}`} className="min-w-0 flex-1 text-[17px] leading-tight font-semibold tracking-tight">
        <Link to={WORKSPACE_HOME[w]} className="rounded outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
          {TITLES[w]}
        </Link>
      </h2>
      {children}
      <kbd className="hidden rounded-md border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground sm:inline" aria-hidden>
        {index}
      </kbd>
    </div>
  );
}

/**
 * A workspace card. The whole card opens the workspace (click, Enter or the number key); buttons inside it do their own
 * thing. One region per card, named by its title (the tests find "Attendance & Shifts" this way).
 */
function WorkspaceCard({ w, index, badge, children, action }: { w: Exclude<Workspace, 'admin'>; index: number; badge?: ReactNode; children: ReactNode; action: ReactNode }) {
  const navigate = useNavigate();
  const openIfCard = (e: React.MouseEvent) => {
    // Clicks on buttons, links, inputs inside the card are theirs.
    if ((e.target as HTMLElement).closest('button, a, input, label, [role=dialog]')) return;
    navigate(WORKSPACE_HOME[w]);
  };
  return (
    <section
      aria-labelledby={`card-${w}`}
      onClick={openIfCard}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card shadow-card transition-[box-shadow,border-color] hover:border-primary/30 hover:shadow-card-lg focus-within:ring-2 focus-within:ring-ring/40"
    >
      <div className="flex flex-1 flex-col gap-4 p-5">
        <CardTitle w={w} index={index} />
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
        tone === 'info' && 'border-primary/25 bg-primary/8 text-primary',
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
  const cls = cn('block rounded-lg border bg-muted/40 px-2 py-2.5 text-center', alert && value ? 'border-destructive/30 bg-destructive/6' : '');
  return to ? (
    <Link
      to={to}
      aria-label={`${value ?? '—'} ${label}`}
      className={cn(cls, 'transition outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40')}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Mark attendance: the first thing on Home. Full width; on wide screens the punch side and today's numbers sit side by side. */
function AttendanceCard({ index, onOpen }: { index: number; onOpen: (to?: string) => void }) {
  const p = usePunch();
  // Punching in is a permission like any other (PLAN.md §19.19); without it the card only opens Attendance.
  const punches = useAccess().tasks.can('attendance.punch');
  const cfg = useHrConfig();
  const balances = useLeaveBalances();
  const now = useMinuteClock();
  const approves = !!cfg.data?.can_approve;
  const leaves = usePendingLeaves(approves);
  const corrections = usePendingCorrections(approves);
  const d = p.data;
  const a = d?.attendance;
  const pending = (leaves.data?.length ?? 0) + (corrections.data?.length ?? 0);

  if (p.query.isError) {
    return (
      <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground shadow-card">
        Attendance isn’t set up for you yet. Ask your company admin if you should be marking attendance.
      </p>
    );
  }

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
    <Pill tone="info">Done for today{a.working_minutes ? ` · ${hrs(a.working_minutes)}` : ''}</Pill>
  ) : a && a.status !== 'not_checked_in' ? (
    <Pill tone="info">{a.status_display}</Pill>
  ) : (
    <Pill tone="bad">Not checked in</Pill>
  );
  return (
    <section aria-labelledby="card-attendance" className="relative overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-6">
        <div className="flex flex-col gap-4">
          <CardTitle w="attendance" index={index} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-mono text-[34px] leading-none font-bold tracking-tight tabular-nums" aria-label="Current time">
              {clock(now)}
            </span>
            {badge}
          </div>
          <div aria-live="polite">
            {p.err && (
              <p role="alert" className="mb-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {p.err}{' '}
                {!p.fix && (
                  <button type="button" className="cursor-pointer font-medium underline" onClick={() => onOpen('/attendance/history')}>
                    Request a correction
                  </button>
                )}
              </p>
            )}
            {p.fix && (
              <Button size="lg" className="mb-2 h-12 w-full" onClick={p.fix.run}>
                {p.fix.label}
              </Button>
            )}
            {p.msg && (
              <p role="status" className="mb-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success">
                {p.msg}
              </p>
            )}
          </div>
          {punches && (state === 'in' || state === 'out') ? (
            <Button variant="cta" size="lg" className="h-13 w-full text-base" disabled={p.busy} loading={p.busy && !p.waitingForCamera} onClick={() => p.markIt(state === 'in' ? 'check_in' : 'check_out')}>
              {p.usesCamera ? <Fingerprint /> : state === 'in' ? <LogIn /> : <LogOut />}
              {state === 'in' ? 'Punch in' : 'Punch out'}
            </Button>
          ) : (
            <Button size="lg" variant="outline" className="h-13 w-full text-base" onClick={() => onOpen()} disabled={!d}>
              {state === 'done' ? `Done for today${a?.working_minutes ? ` · ${hrs(a.working_minutes)}` : ''}` : 'Open attendance'}
            </Button>
          )}
          <Checks p={p} />
        </div>
        <div className="flex flex-col gap-3 md:border-l md:pl-6">
          <div className="grid grid-cols-3 gap-2">
            <Count label="Checked in" value={timeOf(a?.check_in)} small />
            <Count label="Checked out" value={timeOf(a?.check_out)} small />
            <Count label="Worked" value={hrs(a?.working_minutes)} small />
          </div>
          {(balances.data?.length ?? 0) > 0 && (
            <p className="line-clamp-2 text-[13px] text-muted-foreground" title={`Leave left: ${balances.data!.map((b) => `${b.balance} ${b.name}`).join(' · ')}`}>
              Leave left:{' '}
              {balances.data!.slice(0, 2).map((b, i) => (
                <span key={b.leave_type}>
                  {i > 0 && ' · '}
                  <span className="font-mono font-semibold text-foreground">{b.balance}</span> {b.name}
                </span>
              ))}
            </p>
          )}
          <div className="mt-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-11 w-full flex-wrap justify-between gap-x-2 gap-y-1 py-2 whitespace-normal lg:min-h-9"
              onClick={() => onOpen()}
            >
              <span className="inline-flex items-center gap-1.5">
                Open Attendance &amp; Leave <ArrowRight className="size-4" />
              </span>
              {approves && pending > 0 && <Pill tone="warn">{pending} to approve</Pill>}
            </Button>
          </div>
        </div>
      </div>
      {p.camera}
    </section>
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
      action={
        <>
          <Button size="lg" className="h-11 w-full" onClick={() => onOpen()}>
            Open Tasks <ArrowRight />
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11 w-full justify-between lg:min-h-9" onClick={() => onOpen('/tasks/tasks')}>
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
      action={
        <>
          <Button size="lg" className="h-11 w-full" onClick={() => onOpen()}>
            Open Assets <ArrowRight />
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11 w-full justify-between lg:min-h-9" onClick={() => onOpen(canScan ? '/assets/scan' : '/assets/requests')}>
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
  const access = useAccess();
  // Only the Admin screens this person's permissions open (PLAN.md §19.19).
  const items = [
    { name: 'People & access', blurb: 'People, roles, passwords', to: '/people', icon: Users, show: ADMIN_SCREENS.people },
    { name: 'Roles', blurb: 'Permissions and duties', to: '/roles', icon: ShieldCheck, show: ADMIN_SCREENS.roles },
    { name: 'Settings', blurb: 'Company, modules, departments', to: '/settings', icon: Settings2, show: ADMIN_SCREENS.settings },
  ].filter((x) => x.show(access));
  return (
    <section aria-labelledby="admin-title">
      <h2 id="admin-title" className="mb-3 text-base font-semibold tracking-tight">
        Admin
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((x) => (
          <button
            key={x.to}
            type="button"
            onClick={() => onOpen(x.to)}
            className="group flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-card transition hover:border-primary/30 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-app-admin/10 text-app-admin" aria-hidden>
              <x.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold tracking-tight group-hover:text-primary">{x.name}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">{x.blurb}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}
