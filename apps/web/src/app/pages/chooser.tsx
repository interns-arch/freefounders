/**
 * Workspace Portal (PLAN.md §19.2): the first screen after sign-in. One card per workspace with live numbers, punch in /
 * out right here (§19.3), and the admin row. Replaces the plain "Choose your workspace" list; same URL (/ and /?choose).
 */
import { type Access, type AppKey, useAccess, useSignOut } from '@freefounders/core';
import { useAssetsDashboard } from '@freefounders/core/assets';
import { usePeople, useRoles, useCompanySettings } from '@freefounders/core/admin';
import { nearestOffice, useHrConfig, useLeaveBalances, useOfficeLocations, usePendingCorrections, usePendingLeaves } from '@freefounders/core/hr';
import { useMyTaskTiles, useWaitingCounts } from '@freefounders/core/tasks';
import {
  ArrowRight,
  Camera,
  ChevronRight,
  Clock,
  Fingerprint,
  Home,
  KeyRound,
  LogIn,
  LogOut,
  MapPin,
  ScanFace,
  ScanLine,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Avatar, Checkbox, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { AttendanceChip, hrs } from '@/features/hr/parts';
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
const today = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
const timeOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
const ampm = (hhmm: string | undefined) => {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
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

  if (!access.platform) return <PageLoader />;
  const workspaces = workspacesFor(access.apps, access.isAdmin);
  if (!choosing && !next) {
    const saved = remembered();
    if (saved && workspaces.includes(saved)) return <Navigate to={WORKSPACE_HOME[saved]} replace />;
    // Only Assets (no attendance to mark here, no admin row): straight in.
    if (workspaces.length === 1 && workspaces[0] === 'assets') return <Navigate to="/assets" replace />;
  }

  const open = (w: Workspace, to = WORKSPACE_HOME[w]) => {
    try {
      if (keep && w !== 'admin') localStorage.setItem(REMEMBER, w);
      else if (!keep) localStorage.removeItem(REMEMBER);
    } catch {
      /* private mode: fine */
    }
    navigate(to);
  };
  const person = access.platform.person;
  const first = person.fullName.split(' ')[0];
  const tasksOn = access.apps.includes('tasks');
  const level = person.role === 'owner' ? 'Super Admin' : person.role === 'admin' ? 'Admin' : 'Member';
  const apps: AppKey[] = access.apps;

  return (
    <div className="min-h-dvh bg-background pb-24 sm:pb-0">
      <PortalHeader access={access} level={level} />
      <main className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero: the old dashboard's "Good morning, Demo" greeting on a card with a soft green glow. */}
        <section className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-gradient-to-l from-primary/[0.07] to-transparent" />
          <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-brand-2/15 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-72 rounded-full bg-app-attendance/8 blur-3xl" />
          <div className="relative">
            <p className="inline-flex items-center gap-2 font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
              <span className="size-1.5 rounded-full bg-brand-2 shadow-[0_0_0_3px_var(--accent)]" aria-hidden />
              {access.platform.company.name} · Workspace portal
            </p>
            <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-[28px] leading-tight font-extrabold tracking-tight sm:text-[34px]">
                  {greeting()}, {first}
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground sm:text-[15px]">
                  Choose where you want to work today.
                  {person.role !== 'member' && <> You have {level.toLowerCase()} access to this company.</>}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground/80">{today()}</p>
              </div>
              {tasksOn && <ShiftBox />}
            </div>
            {tasksOn && <StatusStrip />}
          </div>
        </section>

        {apps.length === 0 && (
          <p className="rounded-xl border border-warning/30 bg-warning/8 p-4 text-sm">
            You don’t have access to any app yet. {access.isAdmin ? 'Give yourself a role under People & access.' : 'Ask your company admin for access.'}
          </p>
        )}

        {workspaces.some((w) => w !== 'admin') && (
          <section aria-labelledby="choose-title" id="workspaces" className="scroll-mt-20">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="choose-title" className="text-lg font-bold tracking-tight">
                Choose your workspace
              </h2>
              {workspaces.filter((w) => w !== 'admin').length > 1 && (
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-card transition hover:border-primary/40 hover:text-foreground">
                  <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} aria-label="Remember my choice on this device" />
                  Remember my choice on this device
                </label>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {tasksOn && <AttendanceCard onOpen={(to) => open('attendance', to)} />}
              {tasksOn && <TasksCard onOpen={(to) => open('tasks', to)} />}
              {apps.includes('assets') && <AssetsCard access={access} onOpen={(to) => open('assets', to)} />}
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
    <header className="sticky top-0 z-20 border-b bg-card/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Logo company={access.brand} subtitle={access.platform?.company.name !== access.brand?.shortName ? access.platform?.company.name : undefined} />
        <span className="ml-1 hidden rounded-full border border-primary/20 bg-accent px-2.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-wider text-primary uppercase sm:inline">
          Workspace Portal
        </span>
        <div className="flex-1" />
        <ThemeToggle />
        <NotificationsBell />
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <span className="hidden text-right leading-tight sm:block">
          <span className="block text-sm font-semibold">{name}</span>
          <span className="block font-mono text-[10.5px] tracking-wider text-muted-foreground uppercase">{level}</span>
        </span>
        <Avatar name={name} className="size-9 ring-2 ring-primary/20" />
        <Button variant="ghost" size="sm" onClick={() => navigate('/account')} aria-label="Change password" title="Change password">
          <KeyRound /> <span className="hidden md:inline">Change password</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login') })}>
          <LogOut /> <span className="hidden sm:inline">Sign out</span>
          <span className="sr-only sm:hidden">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

/** Office hours and a live clock. */
function ShiftBox() {
  const cfg = useHrConfig();
  const now = useNow();
  return (
    <div className="flex items-center gap-3 self-start rounded-lg border bg-card/80 px-4 py-3 shadow-card lg:self-auto">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-app-attendance/12 text-app-attendance" aria-hidden>
        <Clock className="size-[18px]" />
      </span>
      <div className="leading-tight">
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Shift window</p>
        <p className="font-mono text-sm font-semibold whitespace-nowrap">
          {cfg.data ? `${ampm(cfg.data.work_start)} – ${ampm(cfg.data.work_end)}` : '—'}
        </p>
      </div>
      <span className="mx-1 hidden h-8 w-px bg-border sm:block" aria-hidden />
      <p className="hidden font-mono text-lg font-bold whitespace-nowrap text-primary tabular-nums sm:block" aria-label="Current time">
        {clock(now)}
      </p>
    </div>
  );
}

/** Location, face check and punch-photo rules as they apply to me today. */
function StatusStrip() {
  const p = usePunch();
  const offices = useOfficeLocations();
  const known = useKnownPosition(!!p.data?.geofence_enabled);
  const pos = p.position ?? known;
  const near = pos && offices.data ? nearestOffice(pos, offices.data) : null;
  const d = p.data;
  if (!d) return <Skeleton className="mt-5 h-9" />;
  const items: Array<{ icon: typeof MapPin; text: string; tone?: 'ok' | 'warn' }> = [];
  if (d.geofence_enabled) {
    items.push(
      near
        ? { icon: MapPin, text: `${near.office.name} · ${near.inside ? 'inside' : 'outside'} the area (${near.metres} m)`, tone: near.inside ? 'ok' : 'warn' }
        : { icon: MapPin, text: 'Location is checked when you punch in' },
    );
  } else items.push({ icon: MapPin, text: 'No location check' });
  if (d.face_enabled)
    items.push(
      d.face_enrolled
        ? { icon: ScanFace, text: 'Face check ready', tone: 'ok' }
        : d.face_self_enroll
          ? { icon: ScanFace, text: 'Face saved on your first punch' }
          : { icon: ScanFace, text: 'Face not enrolled — ask an admin', tone: 'warn' },
    );
  if (d.photo && d.photo !== 'off') items.push({ icon: Camera, text: d.photo === 'required' ? 'Selfie at every punch' : 'Selfie optional' });
  return (
    <ul className="mt-5 flex flex-wrap gap-2 border-t pt-4 text-xs" aria-label="Attendance checks">
      {items.map((i) => (
        <li
          key={i.text}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 font-mono font-medium text-muted-foreground shadow-card',
            i.tone === 'ok' && 'border-success/30 bg-success/8 text-success',
            i.tone === 'warn' && 'border-warning/40 bg-warning/8 text-warning',
          )}
        >
          <i.icon className="size-3.5" aria-hidden /> {i.text}
        </li>
      ))}
    </ul>
  );
}

function WorkspaceCard({
  w,
  blurb,
  badge,
  children,
  primary,
  secondary,
}: {
  w: Workspace;
  blurb: string;
  badge?: ReactNode;
  children: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  const look = WORKSPACE_LOOK[w];
  return (
    <section
      aria-labelledby={`card-${w}`}
      className="relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-lg"
    >
      <div aria-hidden className={cn('absolute inset-x-0 top-0 h-1', look.dot)} />
      <div aria-hidden className={cn('pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent', look.glow)} />
      <div className="relative flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <span className={cn('grid size-11 place-items-center rounded-xl shadow-md shadow-black/15', look.solid)} aria-hidden>
            <look.icon className="size-[22px]" />
          </span>
          {badge}
        </div>
        <div>
          <h3 id={`card-${w}`} className="text-[17px] font-bold tracking-tight">
            {w === 'attendance' ? 'Attendance & Shifts' : w === 'tasks' ? 'Tasks & Automations' : 'Assets & Inventory'}
          </h3>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">{blurb}</p>
        </div>
        <div className="flex-1 space-y-3">{children}</div>
        <div className="space-y-2">{primary}</div>
      </div>
      {secondary && <div className="relative border-t bg-muted/30 px-5 py-2.5">{secondary}</div>}
    </section>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap',
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

function Count({ label, value, alert, to }: { label: string; value: number | string | undefined; alert?: boolean; to?: string }) {
  const body = (
    <>
      <span className={cn('block font-mono text-[22px] leading-tight font-bold tabular-nums', alert && 'text-destructive')}>{value ?? '—'}</span>
      <span className="mt-0.5 block font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{label}</span>
    </>
  );
  const cls = cn('block rounded-lg border bg-card px-2 py-2.5 text-center shadow-card', alert && 'border-destructive/30 bg-destructive/6');
  return to ? (
    <Link to={to} className={cn(cls, 'transition outline-none hover:border-primary/40 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function FooterLink({ onClick, children, extra }: { onClick: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-2 rounded-md text-left text-sm font-semibold text-foreground/80 outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <span className="flex-1">{children}</span>
      {extra}
      <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
    </button>
  );
}

function AttendanceCard({ onOpen }: { onOpen: (to?: string) => void }) {
  const p = usePunch();
  const cfg = useHrConfig();
  const balances = useLeaveBalances();
  const approves = !!cfg.data?.can_approve;
  const leaves = usePendingLeaves(approves);
  const corrections = usePendingCorrections(approves);
  const now = useNow();
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
  const badge = !d ? null : a?.check_in && !a.check_out ? (
    <Pill tone="ok">Checked in {timeOf(a.check_in)}</Pill>
  ) : a?.check_out ? (
    <Pill tone="info">Done · {hrs(a.working_minutes)}</Pill>
  ) : a && a.status !== 'not_checked_in' ? (
    <AttendanceChip status={a.status} />
  ) : (
    <Pill tone="bad">Not checked in</Pill>
  );

  return (
    <WorkspaceCard
      w="attendance"
      blurb="Punch in and out, see your attendance, and apply for leave."
      badge={badge}
      primary={
        <>
          {p.err && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {p.err}{' '}
              <button type="button" className="font-medium underline" onClick={() => onOpen('/attendance/history')}>
                Request a correction
              </button>
            </p>
          )}
          {p.msg && (
            <p role="status" className="rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success">
              {p.msg}
            </p>
          )}
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
          {p.camera}
        </>
      }
      secondary={
        <FooterLink onClick={() => onOpen()} extra={approves && pending > 0 ? <Pill tone="warn">{pending} approvals pending</Pill> : undefined}>
          Open Attendance &amp; Leave
        </FooterLink>
      }
    >
      <dl className="divide-y rounded-lg border bg-card text-sm shadow-card">
        <div className="flex items-center justify-between px-3 py-2">
          <dt className="text-muted-foreground">Time now</dt>
          <dd className="font-mono font-semibold tabular-nums">{clock(now)}</dd>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <dt className="text-muted-foreground">Checked in</dt>
          <dd className={cn('font-mono font-semibold', a?.check_in && 'text-success')}>{timeOf(a?.check_in)}</dd>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <dt className="text-muted-foreground">Checked out</dt>
          <dd className="font-mono font-semibold">{timeOf(a?.check_out)}</dd>
        </div>
      </dl>
      {(balances.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {balances.data!.slice(0, 2).map((b) => (
            <div key={b.leave_type} className="rounded-lg border bg-card px-3 py-2 shadow-card">
              <p className="truncate font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{b.name}</p>
              <p className="font-mono text-sm font-bold">
                {b.balance} <span className="font-medium text-muted-foreground">left</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </WorkspaceCard>
  );
}

function TasksCard({ onOpen }: { onOpen: (to?: string) => void }) {
  const tiles = useMyTaskTiles();
  const waiting = useWaitingCounts();
  const t = tiles.data;
  return (
    <WorkspaceCard
      w="tasks"
      blurb="Your tasks, checklists, reviews and the team’s work."
      badge={t && t.overdue > 0 ? <Pill tone="bad">{t.overdue} overdue</Pill> : t ? <Pill tone="ok">On track</Pill> : null}
      primary={
        <Button size="lg" className="h-12 w-full text-base" onClick={() => onOpen()}>
          Open Tasks <ArrowRight />
        </Button>
      }
      secondary={<FooterLink onClick={() => onOpen('/tasks/tasks')}>Open my task list</FooterLink>}
    >
      <div className="grid grid-cols-3 gap-2">
        <Count label="Active" value={t ? t.pending + t.in_progress : undefined} to="/tasks/tasks?tab=my" />
        <Count label="Overdue" value={t?.overdue} alert={!!t?.overdue} to="/tasks/tasks?tab=my&overdue=1" />
        <Count label="To accept" value={waiting.data?.accept} to="/tasks/tasks?tab=reviews" />
      </div>
      <ul className="space-y-1.5 text-[13.5px] text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-app-tasks" aria-hidden />
          <span>
            <span className="font-mono font-semibold text-foreground">{waiting.data?.requests ?? 0}</span> change requests to decide
          </span>
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-app-tasks" aria-hidden />
          <span>
            <span className="font-mono font-semibold text-foreground">{t?.completed ?? 0}</span> completed · <span className="font-mono font-semibold text-foreground">{t?.in_time ?? 0}</span> on
            time
          </span>
        </li>
      </ul>
    </WorkspaceCard>
  );
}

function AssetsCard({ access, onOpen }: { access: Access; onOpen: (to?: string) => void }) {
  const dash = useAssetsDashboard();
  const d = dash.data;
  const canScan = access.assets.can('asset:view', 'asset:assign');
  return (
    <WorkspaceCard
      w="assets"
      blurb="Assets you hold, requests, tickets, joiners and exits."
      badge={dash.error ? <Pill tone="warn">Unavailable</Pill> : d ? <Pill tone="ok">Up to date</Pill> : null}
      primary={
        <Button size="lg" className="h-12 w-full text-base" onClick={() => onOpen()}>
          Open Assets <ArrowRight />
        </Button>
      }
      secondary={
        canScan ? (
          <FooterLink onClick={() => onOpen('/assets/scan')}>
            <span className="inline-flex items-center gap-2">
              <ScanLine className="size-4" aria-hidden /> Scan QR / barcode
            </span>
          </FooterLink>
        ) : (
          <FooterLink onClick={() => onOpen('/assets/requests')}>Request an item</FooterLink>
        )
      }
    >
      {!d ? (
        <Skeleton className="h-16" />
      ) : d.scope === 'organisation' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Count label="Assigned" value={d.totals.assigned} />
            <Count label="Exit items" value={d.totals.exitPendingItems} alert={d.totals.exitPendingItems > 0} />
            <Count label="Open tickets" value={d.totals.openTickets} />
          </div>
          <p className="text-[13.5px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{d.totals.available}</span> available ·{' '}
            <span className="font-mono font-semibold text-foreground">{d.totals.pendingRequests}</span> requests waiting
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Count label="With me" value={d.myAssets.length} />
            <Count label="Exit hold" value={d.openExit ? 1 : 0} alert={!!d.openExit} />
            <Count label="Tickets" value={d.tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length} />
          </div>
          {d.myAssets[0] && (
            <p className="truncate rounded-lg border bg-card px-3 py-2 font-mono text-xs shadow-card">
              {d.myAssets[0].name} · <span className="text-primary">{d.myAssets[0].assetTag}</span>
            </p>
          )}
        </>
      )}
    </WorkspaceCard>
  );
}

function AdminRow({ onOpen }: { onOpen: (to: string) => void }) {
  const people = usePeople('');
  const roles = useRoles();
  const company = useCompanySettings();
  const active = people.data?.filter((p) => p.status === 'active').length;
  const modulesOn = company.data?.modules.reduce((n, a) => n + a.modules.filter((m) => m.on).length, 0);
  const items = [
    { name: 'People & access', blurb: 'Add people, give them roles, reset passwords', to: '/people', icon: Users, count: active != null ? `${active} people` : '' },
    { name: 'Roles', blurb: 'What each role can do, and its duties', to: '/roles', icon: ShieldCheck, count: roles.data ? `${roles.data.length} roles` : '' },
    { name: 'Settings', blurb: 'Company, modules and departments', to: '/settings', icon: Settings2, count: modulesOn != null ? `${modulesOn} modules on` : '' },
  ];
  return (
    <section aria-labelledby="admin-title">
      <h2 id="admin-title" className="mb-4 flex items-center gap-2 text-lg font-bold tracking-tight">
        <span className="grid size-7 place-items-center rounded-lg bg-app-admin/12 text-app-admin" aria-hidden>
          <ShieldCheck className="size-4" />
        </span>
        Admin
        <span aria-hidden className="ml-2 h-px flex-1 bg-border" />
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {items.map((x) => (
          <button
            key={x.to}
            type="button"
            onClick={() => onOpen(x.to)}
            className="group relative overflow-hidden rounded-xl border bg-card p-5 text-left shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-app-admin/40 hover:shadow-card-lg focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-app-admin/8 blur-2xl" />
            <span className="relative flex items-start justify-between gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-app-admin/12 text-app-admin" aria-hidden>
                <x.icon className="size-5" />
              </span>
              {x.count && <span className="rounded-full border bg-background px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">{x.count}</span>}
            </span>
            <span className="relative mt-4 block text-[15px] font-bold tracking-tight">{x.name}</span>
            <span className="relative block text-[13px] text-muted-foreground">{x.blurb}</span>
            <span className="relative mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
              Open <ChevronRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
            </span>
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
