import { ASSET_STATUS_LABELS, ASSET_STATUSES, HOLDER_TYPE_LABELS, type HolderType } from '@eam/shared';
import { Activity, AlertTriangle, ArrowRight, Boxes, CheckCircle2, ClipboardList, LifeBuoy, LogOut, PackageCheck, Plus, ScanLine, ShieldAlert, UserPlus, Wrench } from '@/components/icons';
import { Link, useNavigate } from 'react-router';
import { EnumBadge, HOLDER_ICONS } from '@/components/common/badges';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { StatTile } from '@/features/assets/components/stat-tile';
import { Timeline } from '@/features/assets/components/timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from '@/components/ui/primitives';
import { QueueCard } from '@/features/assets/queue/queue-page';
import { useQuickAdd } from '@/features/assets/quick-add/quick-add';
import { type OrgDashboard, type PersonalDashboard, useAssetsDashboard } from '@freefounders/core/assets';
import { useAuth } from '@/features/assets/lib/auth';
import { QRCode, useQrLinks } from '@/components/common/codes';
import { AssetIcon, COLORS } from '@/lib/icons';
import { useCompanyName } from '@/features/assets/lib/auth';
import { ASSET_STATUS_BAR, REQUEST_TONE, TICKET_TONE } from '@/lib/status';
import { cn, daysUntil, formatDate, formatNumber, plural, relativeTime } from '@/lib/utils';



function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { me } = useAuth();
  const q = useAssetsDashboard();
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const first = me?.user.name.split(' ')[0];
  return q.data.scope === 'organisation' ? <OrgView data={q.data} name={first} /> : <PersonalView data={q.data} name={first} />;
}

function QuickActions() {
  const quickAdd = useQuickAdd();
  const navigate = useNavigate();
  const { can } = useAuth();
  const actions = [
    can('asset:create') && { label: 'Add asset', icon: Plus, onClick: () => quickAdd.open('asset') },
    can('employee:manage') && { label: 'Add employee', icon: UserPlus, onClick: () => quickAdd.open('employee') },
    { label: 'Scan', icon: ScanLine, onClick: () => navigate('/assets/scan') },
    can('request:create') && { label: 'Request', icon: ClipboardList, onClick: () => quickAdd.open('request') },
    can('maintenance:manage') && { label: 'Maintenance', icon: Wrench, onClick: () => quickAdd.open('maintenance') },
  ].filter(Boolean) as { label: string; icon: typeof Plus; onClick: () => void }[];
  return (
    <>
      {actions.map((a, i) => (
        <Button key={a.label} variant={i === 0 ? 'default' : 'outline'} size="sm" onClick={a.onClick}>
          <a.icon /> {a.label}
        </Button>
      ))}
    </>
  );
}

function OrgView({ data, name }: { data: OrgDashboard; name?: string }) {
  const t = data.totals;
  const statusTotal = ASSET_STATUSES.reduce((n, s) => n + (s === 'DISPOSED' ? 0 : data.byStatus[s] ?? 0), 0) || 1;
  const utilisation = t.assets ? Math.round((t.assigned / t.assets) * 100) : 0;
  const { can } = useAuth();

  return (
    <div className="space-y-5">
      <PageHeader title={`${greeting()}${name ? `, ${name}` : ''}`} description="Here’s what’s happening with your assets today." actions={<QuickActions />} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total assets" value={formatNumber(t.assets)} hint="In the register" icon={Boxes} tone="indigo" to="/assets/assets" />
        <StatTile label="Assigned" value={formatNumber(t.assigned)} hint={`${utilisation}% in use`} icon={PackageCheck} tone="violet" to="/assets/assets?status=ASSIGNED" />
        <StatTile label="Available" value={formatNumber(t.available)} hint="Ready to assign" icon={CheckCircle2} tone="green" to="/assets/assets?status=AVAILABLE" />
        <StatTile
          label="Pending exit recoveries"
          value={formatNumber(t.exitPendingItems)}
          hint={`${plural(t.onNotice, 'employee')} on notice`}
          icon={LogOut}
          tone={t.exitPendingItems ? 'amber' : 'default'}
          to="/assets/exits"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="In maintenance" value={t.inMaintenance} hint="Being repaired or serviced" icon={Wrench} tone={t.inMaintenance ? 'amber' : 'default'} to="/assets/assets?status=IN_MAINTENANCE" />
        <StatTile label="Open tickets" value={t.openTickets} hint="Issues raised against assets" icon={LifeBuoy} to="/assets/tickets" tone={t.openTickets ? 'red' : 'default'} />
        <StatTile label="Requests to action" value={t.pendingRequests + t.approvedRequests} hint={`${t.pendingRequests} pending · ${t.approvedRequests} to fulfil`} icon={ClipboardList} tone={t.pendingRequests + t.approvedRequests ? 'blue' : 'default'} to="/assets/requests" />
        <StatTile label="Warranties expiring (30d)" value={t.warrantyExpiring} hint={t.lost ? `${t.lost} lost asset(s)` : 'Next 30 days'} icon={ShieldAlert} tone={t.warrantyExpiring ? 'amber' : 'default'} to="/assets/assets?warranty=expiring" />
      </div>

      {can('ticket:manage', 'request:approve', 'request:fulfil') && <QueueCard />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Assets by status</CardTitle>
              <CardDescription>{formatNumber(statusTotal)} in the register (excluding disposed)</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex h-3.5 gap-px overflow-hidden rounded-full bg-muted">
              {ASSET_STATUSES.filter((s) => s !== 'DISPOSED' && data.byStatus[s]).map((s) => (
                <div key={s} className={cn('h-full transition-all', ASSET_STATUS_BAR[s])} style={{ width: `${((data.byStatus[s] ?? 0) / statusTotal) * 100}%` }} title={`${ASSET_STATUS_LABELS[s]}: ${data.byStatus[s]}`} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {ASSET_STATUSES.filter((s) => data.byStatus[s]).map((s) => (
                <Link key={s} to={`/assets/assets?status=${s}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 max-sm:min-h-[2.5rem] text-sm transition hover:bg-muted">
                  <span className={cn('size-2.5 rounded-sm', ASSET_STATUS_BAR[s])} />
                  <span className="flex-1 text-muted-foreground">{ASSET_STATUS_LABELS[s]}</span>
                  <span className="font-mono text-[13px] font-semibold tabular">{data.byStatus[s]}</span>
                </Link>
              ))}
            </div>

            <div>
              <p className="mb-2 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">By category</p>
              {!data.byCategory.length && <p className="text-sm text-muted-foreground">No categories hold assets yet.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {data.byCategory.map((c) => {
                  const pct = c.count ? Math.round((c.assigned / c.count) * 100) : 0;
                  return (
                    <Link key={c.id} to={`/assets/assets?categoryId=${c.id}`} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-2.5 transition hover:border-primary/40 hover:bg-card hover:shadow-xs">
                      <AssetIcon icon={c.icon} color={c.color} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="font-mono text-xs tabular text-muted-foreground">
                            <span className="font-semibold text-foreground">{c.assigned}</span>/{c.count} in use
                          </span>
                        </div>
                        <Progress value={pct} className="mt-1.5 h-1.5" indicatorClassName={COLORS[c.color ?? '']?.bar} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Exits in progress</CardTitle>
              <CardDescription>Assets still to recover</CardDescription>
            </div>
            <Button variant="ghost" size="xs" asChild>
              <Link to="/assets/exits">
                All <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {!data.exits.length ? (
              <EmptyState icon={LogOut} title="No one is leaving" description="Exit checklists appear here when HR moves someone to notice period." className="py-8" />
            ) : (
              <ul className="space-y-3">
                {data.exits.map((x) => {
                  const days = daysUntil(x.lastWorkingDate) ?? 0;
                  const done = x.total - x.pending;
                  return (
                    <li key={x.id}>
                      <Link to={`/assets/exits/${x.id}`} className="block rounded-xl border bg-muted/20 p-3 transition hover:border-primary/40 hover:bg-card hover:shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{x.employeeName}</span>
                          <span className={cn('text-xs font-medium', days < 0 ? 'text-destructive' : days <= 3 ? 'text-warning' : 'text-muted-foreground')}>
                            {days < 0 ? `${-days}d overdue` : days === 0 ? 'Last day today' : `${days}d left`}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Progress value={x.total ? (done / x.total) * 100 : 100} className="h-1.5" indicatorClassName={x.pending ? 'bg-warning' : 'bg-success'} />
                          <span className="shrink-0 text-xs tabular text-muted-foreground">
                            {done}/{x.total}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Availability by type</CardTitle>
              <CardDescription>What can be handed out right now</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!data.byType.length && <EmptyState icon={Boxes} title="No asset types yet" className="py-8" />}
            <ul className="space-y-1">
              {data.byType.map((ty) => (
                <li key={ty.id}>
                  <Link to={`/assets/assets?assetTypeId=${ty.id}&status=AVAILABLE`} className="-mx-1.5 flex items-center gap-3 rounded-md max-sm:min-h-[2.5rem] px-1.5 py-1 text-sm transition hover:bg-muted">
                    <AssetIcon icon={ty.icon} color="indigo" size="sm" />
                    <span className="min-w-0 flex-1 truncate">{ty.name}</span>
                    <span className={cn('font-mono text-[13px] font-semibold tabular', ty.available === 0 ? 'text-destructive' : 'text-success')}>{ty.available}</span>
                    <span className="w-12 text-right font-mono text-xs tabular text-muted-foreground">of {ty.total}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Who has the assets</CardTitle>
              <CardDescription>By holder</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(data.byHolder) as [HolderType, number][]).map(([h, n]) => {
                const I = HOLDER_ICONS[h];
                return (
                  <Link key={h} to={`/assets/assets?holderType=${h}`} className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-xs transition hover:border-primary/40 hover:bg-card">
                    <I className="size-3.5 text-primary" /> {h === 'INVENTORY' ? 'In store' : HOLDER_TYPE_LABELS[h]} <span className="font-mono font-semibold tabular">{n}</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Warranty expiring soon</CardTitle>
              <CardDescription>Next 30 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!data.expiring.length ? (
              <EmptyState icon={CheckCircle2} title="Nothing expiring" className="py-8" />
            ) : (
              <ul className="divide-y">
                {data.expiring.map((a) => (
                  <li key={a.id}>
                    <Link to={`/assets/assets/${a.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-primary">
                      <AlertTriangle className="size-4 shrink-0 text-warning" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{a.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.assetTag}
                          {a.holderName ? ` · ${a.holderName}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(a.warrantyExpiry)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-primary" /> Recent activity
            </CardTitle>
            <CardDescription>Every change is recorded permanently</CardDescription>
          </div>
          <Button variant="ghost" size="xs" asChild>
            <Link to="/assets/activity">
              Activity log <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Timeline events={data.activity} showEntity />
        </CardContent>
      </Card>
    </div>
  );
}

const REQUEST_STEPS = ['Requested', 'Approved', 'Received'] as const;

function RequestProgress({ status }: { status: PersonalDashboard['requests'][number]['status'] }) {
  if (status === 'REJECTED' || status === 'CANCELLED') {
    return <EnumBadge value={status} tones={REQUEST_TONE} />;
  }
  const reached = status === 'PENDING' ? 0 : status === 'APPROVED' ? 1 : 2;
  return (
    <div className="flex items-center gap-1.5" aria-label={`Step ${reached + 1} of 3: ${REQUEST_STEPS[reached]}`}>
      {REQUEST_STEPS.map((step, i) => (
        <div key={step} className="flex flex-1 flex-col gap-1">
          <span className={cn('h-1.5 rounded-full', i <= reached ? (reached === 2 ? 'bg-success' : 'bg-primary') : 'bg-muted')} />
          <span className={cn('text-xs', i === reached ? 'font-medium text-foreground' : 'text-muted-foreground')}>{step}</span>
        </div>
      ))}
    </div>
  );
}

function PersonalView({ data, name }: { data: PersonalDashboard; name?: string }) {
  const quickAdd = useQuickAdd();
  const { me } = useAuth();
  const company = useCompanyName();
  const links = useQrLinks();
  const openRequests = data.requests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED').length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
      {/* Welcome */}
      <div className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground sm:p-6">
        <div className="relative flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {company.short && <p className="font-mono text-[11px] font-medium tracking-wider text-primary-foreground/75 uppercase">{company.short}</p>}
            <h1 className="mt-1 text-[26px] leading-tight font-bold tracking-tight sm:text-[28px]">
              {greeting()}
              {name ? `, ${name}` : ''}
            </h1>
            <p className="mt-1 text-sm text-primary-foreground/80">
              {data.myAssets.length ? `You have ${plural(data.myAssets.length, 'item')} from the company.` : 'No company items are assigned to you.'}
            </p>
            {me?.employee && <span className="mt-3 inline-block rounded-md bg-primary-foreground/15 px-2 py-0.5 font-mono text-xs">{me.employee.employeeCode}</span>}
          </div>
          {me?.employee && links.ready && (
            <Link to={`/assets/employees/${me.employee.id}`} className="shrink-0 rounded-xl bg-white p-1.5 shadow-md transition active:scale-95" aria-label="Open my QR">
              <QRCode value={links.person(me.employee.employeeCode)} size={64} />
              <span className="block pt-0.5 text-center text-xs font-semibold text-primary">My QR</span>
            </Link>
          )}
        </div>
      </div>

      {data.openExit && (
        <Link
          to={`/assets/exits/${data.openExit.id}`}
          className="flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 p-4 text-warning"
        >
          <LogOut className="size-5 shrink-0" />
          <span className="flex-1 text-sm">
            <span className="font-medium">Please return your company items</span> by {formatDate(data.openExit.lastWorkingDate)}.
          </span>
          <ArrowRight className="size-4" />
        </Link>
      )}

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => quickAdd.open('request')}
          className="flex cursor-pointer flex-col items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition hover:border-primary/40 hover:shadow-sm active:scale-[0.98]"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
            <Plus className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Request an asset</span>
            <span className="block text-xs text-muted-foreground">Laptop, SIM, chair — anything</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => quickAdd.open('ticket')}
          className="flex cursor-pointer flex-col items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition hover:border-warning/50 hover:shadow-sm active:scale-[0.98]"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-warning/12 text-warning">
            <LifeBuoy className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Report a problem</span>
            <span className="block text-xs text-muted-foreground">Broken, lost or not working</span>
          </span>
        </button>
      </div>

      {/* Assets */}
      <Card className="rounded-2xl">
        <CardHeader>
          <div>
            <CardTitle className="text-base">My assets</CardTitle>
            <CardDescription>View only — ask IT for any change</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {!data.myAssets.length ? (
            <EmptyState icon={Boxes} title="Nothing assigned yet" description="Need something for work? Tap “Request an asset”." className="py-8" />
          ) : (
            <ul className="space-y-2">
              {data.myAssets.map((a) => (
                <li key={a.allocationId}>
                  <Link to={`/assets/assets/${a.assetId}`} className="flex items-center gap-3 rounded-xl border p-3 transition hover:border-primary/40 active:bg-muted">
                    <AssetIcon icon={a.typeIcon ?? a.categoryIcon} color={a.categoryColor} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {a.name}
                        {a.quantity > 1 && <span className="text-muted-foreground"> ×{a.quantity}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {a.typeName} · since {formatDate(a.assignedAt)}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Requests */}
      <Card className="rounded-2xl">
        <CardHeader>
          <div>
            <CardTitle className="text-base">My requests</CardTitle>
            <CardDescription>{openRequests ? `${openRequests} waiting` : 'Everything you’ve asked for'}</CardDescription>
          </div>
          <Button variant="ghost" size="xs" asChild>
            <Link to="/assets/requests?status=ALL">
              All <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {!data.requests.length ? (
            <EmptyState icon={ClipboardList} title="No requests yet" className="py-6" />
          ) : (
            <ul className="space-y-3">
              {data.requests.map((r) => (
                <li key={r.id} className="rounded-xl border p-3">
                  <div className="mb-2.5 flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {r.quantity > 1 ? `${r.quantity} × ` : ''}
                      {r.typeName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span>
                  </div>
                  <RequestProgress status={r.status} />
                  {r.decisionNote && <p className="mt-2 text-xs text-muted-foreground">IT: {r.decisionNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.tickets.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">My problem reports</CardTitle>
            <Button variant="ghost" size="xs" asChild>
              <Link to="/assets/tickets">
                All <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.tickets.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <EnumBadge value={t.status} tones={TICKET_TONE} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
