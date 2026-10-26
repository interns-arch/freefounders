/** Inside now (roll call), My visitors (hosts), the Register and Guard activity (Admin / Owner) — PLAN.md §22. */
import { errorMessage } from '@freefounders/core';
import { fileSlug } from '@freefounders/core/export';
import {
  type ActivityFilters,
  type Visit,
  type VisitFilters,
  type VisitorConfig,
  VISIT_STATUS_LABELS,
  formatMinutes,
  useDecideVisit,
  useGateActivity,
  useGuards,
  useInsideNow,
  useVisitPhoto,
  useVisits,
  visitorExports,
} from '@freefounders/core/visitors';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Car, Check, UserCheck, Users, X } from '@/components/icons';
import { DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { EmptyState, PageHeader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { cn, todayISO } from '@/lib/utils';
import { PrivatePhoto, StatusBadge, clock, hostName } from './parts';

// ─── Inside now ───────────────────────────────────────────────────────────────

export function InsidePage() {
  const q = useInsideNow();
  const d = q.data;
  const tiles = [
    { label: 'Visitors', n: d?.visitors.reduce((s, v) => s + v.people, 0) ?? 0, icon: UserCheck },
    { label: 'Vehicles', n: d?.vehicles.length ?? 0, icon: Car },
    { label: 'Employees punched in', n: d?.employees.length ?? 0, icon: Users },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inside now"
        description="Emergency roll call: visitors, vehicles and employees punched in today and not out."
        actions={<DownloadMenu filename={fileSlug('visitors-inside', todayISO())} target={visitorExports.inside()} loading={q.isLoading} />}
      />
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-4">
              <t.icon className="size-5 text-muted-foreground" aria-hidden />
              <p className="mt-1 text-2xl font-bold">{t.n}</p>
              <p className="text-[13px] text-muted-foreground">{t.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Visitors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d?.visitors.length ? (
              d.visitors.map((v) => (
                <p key={v.id} className="text-sm">
                  <span className="font-medium">{v.name}</span>
                  {v.people > 1 ? ` +${v.people - 1}` : ''} · {hostName(v)} · since {clock(v.check_in_at)}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d?.vehicles.length ? (
              d.vehicles.map((e) => (
                <p key={e.id} className="text-sm">
                  <span className="font-mono font-medium">{e.number}</span> · {e.type_display} · since {clock(e.in_at)}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Employees</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d?.employees.length ? (
              d.employees.map((p) => (
                <p key={p.id} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  {p.department ? ` · ${p.department}` : ''} · since {clock(p.check_in)}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── My visitors (hosts) ──────────────────────────────────────────────────────

export function MyVisitorsPage() {
  const list = useVisits({ scope: 'mine' }, { live: true, pageSize: 100 });
  const decide = useDecideVisit();
  const [params] = useSearchParams();
  const focus = Number(params.get('visit')) || null;
  const rows = list.data?.results ?? [];
  const answer = async (v: Visit, decision: 'allow' | 'deny') => {
    try {
      await decide.mutateAsync({ id: v.id, decision });
      toast.success(decision === 'allow' ? `${v.name} allowed in` : `${v.name} denied`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="My visitors" description="People who came to the gate to meet you." />
      {list.isLoading ? null : rows.length === 0 ? (
        <EmptyState icon={UserCheck} title="No visitors yet" description="When someone comes to meet you, the gate checks them in and you are told here." />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {rows.map((v) => (
            <MyVisitCard key={v.id} visit={v} focus={focus === v.id}>
              {v.status === 'waiting_host' && (
                <>
                  <Button size="lg" variant="success" onClick={() => void answer(v, 'allow')} loading={decide.isPending}>
                    <Check /> Allow
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => void answer(v, 'deny')} disabled={decide.isPending}>
                    <X /> Deny
                  </Button>
                </>
              )}
            </MyVisitCard>
          ))}
        </div>
      )}
    </div>
  );
}

function MyVisitCard({ visit: v, focus, children }: { visit: Visit; focus: boolean; children?: React.ReactNode }) {
  const photo = useVisitPhoto(v.has_photo ? v.id : null);
  return (
    <Card className={cn(focus && 'ring-2 ring-primary/40')}>
      <CardContent className="flex gap-3 pt-4">
        <PrivatePhoto query={photo} alt={v.name} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{v.name}</span>
            <StatusBadge visit={v} />
          </div>
          <p className="text-[13px] text-muted-foreground">{[v.company, v.purpose, v.people > 1 ? `${v.people} people` : null, v.mobile].filter(Boolean).join(' · ')}</p>
          <p className="text-[13px] text-muted-foreground">
            {clock(v.check_in_at ?? v.created_at)}
            {v.check_out_at ? ` – ${clock(v.check_out_at)}` : ''} · {formatMinutes(v.minutes_inside)}
          </p>
          {children && <div className="flex flex-wrap gap-2 pt-1 max-sm:[&>button]:flex-1">{children}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── The register (view_all) ──────────────────────────────────────────────────

export function RegisterPage({ config }: { config: VisitorConfig }) {
  const [f, setF] = useState<VisitFilters>({ date_from: todayISO(-7), date_to: todayISO(), status: '', purpose: '', q: '' });
  const [page, setPage] = useState(1);
  const list = useVisits(f, { page, pageSize: 50 });
  const [open, setOpen] = useState<Visit | null>(null);
  const set = (k: keyof VisitFilters, v: string) => {
    setF((cur) => ({ ...cur, [k]: v }));
    setPage(1);
  };
  const rows = list.data?.results ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / 50));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Visitor register"
        description={`${list.data?.count ?? 0} visits`}
        actions={<DownloadMenu filename={fileSlug('visitors-register', f.date_from, f.date_to)} target={visitorExports.visits(f)} empty={!rows.length} loading={list.isLoading} />}
      />
      <div className="flex flex-wrap items-end gap-2">
        <SearchField value={f.q ?? ''} onChange={(v) => set('q', v)} label="Search name, mobile, company, pass" className="w-full max-w-xs" />
        <Input type="date" value={f.date_from} onChange={(e) => set('date_from', e.target.value)} aria-label="From" className="w-auto" />
        <Input type="date" value={f.date_to} onChange={(e) => set('date_to', e.target.value)} aria-label="To" className="w-auto" />
        <NativeSelect value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status" className="w-auto">
          <option value="">Any status</option>
          {Object.entries(VISIT_STATUS_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={f.purpose} onChange={(e) => set('purpose', e.target.value)} aria-label="Purpose" className="w-auto">
          <option value="">Any purpose</option>
          {config.purposes.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </NativeSelect>
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={setOpen}
        empty="No visits match."
        columns={[
          { key: 'name', header: 'Visitor', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'company', header: 'From', cell: (r) => r.company || '—', hideOnMobile: true },
          { key: 'host', header: 'To meet', cell: (r) => hostName(r) },
          { key: 'purpose', header: 'Purpose', cell: (r) => r.purpose || '—', hideOnMobile: true },
          { key: 'in', header: 'In', cell: (r) => clock(r.check_in_at ?? r.created_at) },
          { key: 'out', header: 'Out', cell: (r) => clock(r.check_out_at) },
          { key: 'time', header: 'Inside', cell: (r) => formatMinutes(r.minutes_inside) },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge visit={r} /> },
          { key: 'by', header: 'Checked in by', cell: (r) => r.check_in_by || '—', hideOnMobile: true },
        ]}
      />
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      <VisitDialog visit={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function VisitDialog({ visit: v, onClose }: { visit: Visit | null; onClose: () => void }) {
  const photo = useVisitPhoto(v?.has_photo ? v.id : null);
  const log = useGateActivity({ visit: v?.id }, 1, !!v);
  return (
    <Dialog open={!!v} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {v && (
          <>
            <DialogHeader>
              <DialogTitle>
                {v.name} <span className="font-mono text-base text-muted-foreground">{v.pass_no}</span>
              </DialogTitle>
              <DialogDescription>{[v.company, v.mobile, v.purpose].filter(Boolean).join(' · ')}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-3">
              <PrivatePhoto query={photo} alt={v.name} className="size-28 shrink-0" />
              <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {[
                  ['To meet', hostName(v)],
                  ['Gate', v.location?.name],
                  ['In', `${clock(v.check_in_at)}${v.check_in_by ? ` by ${v.check_in_by}` : ''}`],
                  ['Out', v.check_out_at ? `${clock(v.check_out_at)}${v.check_out_by ? ` by ${v.check_out_by}` : ''}` : ''],
                  ['Inside', formatMinutes(v.minutes_inside)],
                  ['People', v.people > 1 ? String(v.people) : ''],
                  ['ID', v.id_last4 ? `${v.id_type} …${v.id_last4}` : ''],
                  ['Vehicle', v.vehicle_no],
                  ['Items', v.items],
                  ['Notes', v.notes],
                  ['Came by', v.source === 'open_link' ? 'QR self sign-in' : 'At the gate'],
                ]
                  .filter(([, x]) => x)
                  .map(([k, x]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{x}</dd>
                    </div>
                  ))}
              </dl>
            </div>
            {!!log.data?.results.length && (
              <div className="space-y-1 border-t pt-3 text-[13px]">
                <p className="font-semibold">History</p>
                {log.data.results.map((g) => (
                  <p key={g.id} className="text-muted-foreground">
                    {clock(g.at)} · {g.actor?.name ?? '—'} · {g.summary || g.action_display}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Guard activity (view_all) ────────────────────────────────────────────────

const ACTIONS: Array<[string, string]> = [
  ['visit_in', 'Visitor in'],
  ['visit_out', 'Visitor out'],
  ['open_accept', 'QR sign-in accepted'],
  ['open_reject', 'Turned away'],
  ['visit_edit', 'Visitor record changed'],
  ['vehicle_in', 'Vehicle in'],
  ['vehicle_out', 'Vehicle out'],
  ['vehicle_edit', 'Vehicle record changed'],
  ['host_allow,host_deny', 'Host answers'],
  ['settings,link', 'Settings and QR'],
];

export function ActivityPage() {
  const [f, setF] = useState<ActivityFilters>({ actor: '', action: '', date_from: todayISO(-7), date_to: todayISO() });
  const [page, setPage] = useState(1);
  const list = useGateActivity(f, page);
  const guards = useGuards();
  const rows = list.data?.results ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / 50));
  const set = (k: keyof ActivityFilters, v: string) => {
    setF((cur) => ({ ...cur, [k]: k === 'actor' ? (v ? Number(v) : '') : v }));
    setPage(1);
  };
  const guard = guards.data?.find((g) => g.id === f.actor);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Guard activity"
        description="Every action at the gate: who, when and what, with changes from before to after."
        actions={<DownloadMenu filename={fileSlug('visitors-guard-activity', guard?.name, f.date_from, f.date_to)} target={visitorExports.activity(f)} empty={!rows.length} loading={list.isLoading} />}
      />
      <div className="flex flex-wrap items-end gap-2">
        <NativeSelect value={f.actor ?? ''} onChange={(e) => set('actor', e.target.value)} aria-label="Guard" className="w-auto">
          <option value="">Everyone</option>
          {(guards.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={f.action} onChange={(e) => set('action', e.target.value)} aria-label="Action" className="w-auto">
          <option value="">Any action</option>
          {ACTIONS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" value={f.date_from} onChange={(e) => set('date_from', e.target.value)} aria-label="From" className="w-auto" />
        <Input type="date" value={f.date_to} onChange={(e) => set('date_to', e.target.value)} aria-label="To" className="w-auto" />
        {guard && (
          <Button asChild variant="link" size="sm">
            <Link to={`/attendance/history?user=${guard.id}&name=${encodeURIComponent(guard.name)}`}>{guard.name}’s attendance</Link>
          </Button>
        )}
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty="Nothing in this period."
        columns={[
          { key: 'at', header: 'When', cell: (r) => clock(r.at) },
          { key: 'who', header: 'Who', cell: (r) => r.actor?.name ?? '—' },
          { key: 'what', header: 'Action', cell: (r) => r.action_display },
          {
            key: 'details',
            header: 'Details',
            cell: (r) => (
              <span>
                {r.summary}
                {Object.entries(r.changes ?? {}).map(([k, [a, b]]) => (
                  <span key={k} className="block text-[13px] text-muted-foreground">
                    {k.replace(/_/g, ' ')}: {String(a ?? '') || '—'} → {String(b ?? '') || '—'}
                  </span>
                ))}
              </span>
            ),
          },
        ]}
      />
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
