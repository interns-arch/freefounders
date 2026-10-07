import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Gift,
  KeyRound,
  LogOut,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Printer,
  ShieldOff,
  Undo2,
  UserCog,
  UserPlus,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AssetStatusBadge, EmployeeStatusBadge, EnumBadge } from '@/components/common/badges';
import { LocalQrWarning, QRCode, useQrLinks } from '@/components/common/codes';
import { useConfirm } from '@/components/common/confirm';
import { DetailList, EmptyState, ErrorState, PageLoader } from '@/components/common/page';
import { EntityPicker } from '@/components/common/pickers';
import { Timeline } from '@/components/common/timeline';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { AssetActionDialog, type AssetDialog } from '@/features/assets/asset-actions';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api, errorMessage, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { invalidateAssetData, queryClient } from '@/lib/queries';
import { EXIT_CASE_TONE } from '@/lib/status';
import type { Allocation, AssetListItem, EmployeeDetail, HeldAsset, HistoryEvent } from '@/lib/types';
import { cn, daysUntil, formatDate, formatDateTime, relativeTime } from '@/lib/utils';
import { AccessDialog, type AccessInput, type Credentials, CredentialsDialog } from './access';
import { StatusDialog } from './status-dialog';

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const [statusOpen, setStatusOpen] = useState(false);
  const [dialog, setDialog] = useState<AssetDialog | null>(null);
  const [pickAsset, setPickAsset] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api.get<EmployeeDetail>(`/employees/${id}`), placeholderData: undefined });
  const history = useQuery({ queryKey: ['history', 'employee', id], queryFn: () => api.get<Page<HistoryEvent>>(`/employees/${id}/history`), enabled: !!q.data });

  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['employee', id] }), queryClient.invalidateQueries({ queryKey: ['history', 'employee', id] })]);
  const verify = useMutation({
    mutationFn: () => api.post(`/employees/${id}/verify-assets`, {}),
    onSuccess: async () => {
      await refresh();
      toast.success('Marked as checked today');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const access = useMutation({
    mutationFn: (body: AccessInput) => api.post<Credentials>(`/employees/${id}/access`, body),
    onSuccess: async (r) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['users'] })]);
      setAccessOpen(false);
      setCredentials(r);
    },
  });
  const disable = useMutation({
    mutationFn: (userId: string) => api.patch(`/users/${userId}`, { isActive: false }),
    onSuccess: async () => {
      await refresh();
      toast.success('Login turned off');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data;
  const self = me?.employee?.id === e.id;
  const exited = e.status === 'EXITED';
  const lwd = daysUntil(e.lastWorkingDate);
  const canAssign = can('asset:assign');
  const assetOf = (h: HeldAsset) => ({ id: h.assetId, assetTag: h.assetTag, name: h.name, trackingMode: h.trackingMode, holderType: 'EMPLOYEE' as const, holderName: e.fullName });
  const allocationOf = (h: HeldAsset) => ({ id: h.allocationId, holderName: e.fullName, quantity: h.quantity, holderType: 'EMPLOYEE' }) as unknown as Allocation;

  const idCard = <IdCardPanel employee={e} self={self} />;
  const contact = <ContactPanel employee={e} />;
  const login = (can('user:manage') || e.login) && !self && (
    <LoginPanel
      employee={e}
      busy={access.isPending || disable.isPending}
      onGrant={() => {
        access.reset();
        setAccessOpen(true);
      }}
      onDisable={async () => {
        const r = await confirm({ title: `Turn off ${e.fullName}’s login?`, description: 'They will be signed out and can’t sign in until you give access again.', confirmText: 'Turn off', destructive: true });
        if (r.confirmed && e.login) disable.mutate(e.login.id);
      }}
    />
  );
  const profile = (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <DetailList
          columns={1}
          items={[
            { label: 'Department', value: e.departmentName },
            { label: 'Reports to', value: e.managerName },
            { label: 'Joined', value: e.joinDate && formatDate(e.joinDate) },
            ...(e.noticeDate ? [{ label: 'Notice given', value: formatDate(e.noticeDate) }] : []),
            ...(e.lastWorkingDate ? [{ label: 'Last working day', value: <span className={cn(lwd !== null && lwd <= 3 && 'font-medium text-amber-600')}>{formatDate(e.lastWorkingDate)}</span> }] : []),
            ...(e.exitDate ? [{ label: 'Exited on', value: formatDate(e.exitDate) }] : []),
            ...(e.notes ? [{ label: 'Notes', value: e.notes }] : []),
          ]}
        />
        {e.directReports.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs text-muted-foreground">Direct reports</p>
            <ul className="space-y-2">
              {e.directReports.map((r) => (
                <li key={r.id}>
                  <Link to={`/employees/${r.id}`} className="flex items-center gap-2 text-sm hover:text-primary">
                    <Avatar name={r.fullName} className="size-6" />
                    <span className="flex-1 truncate">{r.fullName}</span>
                    <span className="truncate text-xs text-muted-foreground">{r.designation}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {can('employee:view') && (
        <Link to="/employees" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Employees
        </Link>
      )}

      {/* Who */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3 sm:gap-4">
          <Avatar name={e.fullName} className="size-14 text-base sm:size-16 sm:text-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">{e.fullName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.employeeCode}</span>
              <EmployeeStatusBadge status={e.status} />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{[e.designation, e.departmentName].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          {(can('employee:status') || can('employee:manage')) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {can('employee:manage') && (
                  <DropdownMenuItem onSelect={() => quickAdd.open('employee', { record: e })}>
                    <Pencil /> Edit details
                  </DropdownMenuItem>
                )}
                {can('employee:status') && e.status !== 'JOINING' && (
                  <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
                    <UserCog /> Change status / notice period
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {canAssign && !exited && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
            <Button onClick={() => setPickAsset(true)} className="h-11 sm:h-9">
              <UserPlus /> Assign asset
            </Button>
            <Button variant="outline" onClick={() => verify.mutate()} loading={verify.isPending} className="h-11 sm:h-9">
              <ClipboardCheck /> Mark checked
            </Button>
          </div>
        )}
      </Card>

      {e.status === 'JOINING' && e.onboarding && (
        <Link
          to={`/onboarding/${e.onboarding.id}`}
          className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 transition hover:border-violet-300 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
        >
          <UserPlus className="size-4 shrink-0" />
          <span className="flex-1">
            New joiner — joining <span className="font-semibold">{formatDate(e.onboarding.joinDate)}</span>. Onboarding {e.onboarding.caseNumber} →
          </span>
        </Link>
      )}

      {e.openExitCase && (
        <Link
          to={`/exits/${e.openExitCase.id}`}
          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:border-amber-300 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <LogOut className="size-4 shrink-0" />
          <span className="flex-1">
            On notice — last day <span className="font-semibold">{formatDate(e.openExitCase.lastWorkingDate)}</span>
            {lwd !== null && <> ({lwd < 0 ? `${-lwd} days overdue` : lwd === 0 ? 'today' : `${lwd} days left`})</>}. Return checklist {e.openExitCase.caseNumber} →
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 lg:col-span-2">
          {/* Their own QR comes first for the person themselves; IT sees the assets first. */}
          {self && <div className="lg:hidden">{idCard}</div>}
          {/* What they hold */}
          <Card>
            <CardHeader className="flex-wrap">
              <div>
                <CardTitle className="text-base">{self ? 'My assets' : 'Assets held'} ({e.assets.length})</CardTitle>
                <p className={cn('mt-0.5 flex items-center gap-1 text-xs', e.assetsVerifiedAt ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                  {e.assetsVerifiedAt ? (
                    <>
                      <CheckCircle2 className="size-3.5" />
                      <span title={formatDateTime(e.assetsVerifiedAt)}>
                        Last checked {formatDate(e.assetsVerifiedAt)} ({relativeTime(e.assetsVerifiedAt)}){e.assetsVerifiedByName ? ` by ${e.assetsVerifiedByName}` : ''}
                      </span>
                    </>
                  ) : (
                    'Never checked in person'
                  )}
                </p>
              </div>
              {e.assets.length > 0 && can('asset:view') && (
                <Button size="xs" variant="ghost" asChild>
                  <Link to={`/assets?employeeId=${e.id}`}>
                    <Boxes /> Open in assets
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {e.assets.length === 0 ? (
                <EmptyState icon={Boxes} title={self ? 'Nothing is assigned to you' : 'No assets assigned'} className="py-8" />
              ) : (
                <ul className="grid gap-2 2xl:grid-cols-2">
                  {e.assets.map((h) => (
                    <li key={h.allocationId} className="rounded-xl border transition hover:border-primary/40">
                      <Link to={`/assets/${h.assetId}`} className="flex items-center gap-3 p-3">
                        <AssetIcon icon={h.typeIcon ?? h.categoryIcon} color={h.categoryColor} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {h.name}
                            {h.quantity > 1 && <span className="ml-1 text-muted-foreground">×{h.quantity}</span>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            <span className="font-mono">{h.assetTag}</span> · {h.typeName}
                          </span>
                          {h.serialNumber && <span className="block truncate font-mono text-[11px] text-muted-foreground">SN {h.serialNumber}</span>}
                        </span>
                        <AssetStatusBadge status={h.status} className="self-start" />
                      </Link>
                      {canAssign && (
                        <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
                          <span className="whitespace-nowrap">Since {formatDate(h.assignedAt)}</span>
                          <span className="flex gap-1">
                            <Button size="xs" variant="ghost" onClick={() => setDialog({ kind: 'transfer', asset: assetOf(h), allocation: allocationOf(h) })}>
                              <ArrowRightLeft /> Transfer
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setDialog({ kind: 'return', asset: assetOf(h), allocation: allocationOf(h) })}>
                              <Undo2 /> Return
                            </Button>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4 lg:hidden">
            {!self && idCard}
            {contact}
            {login}
          </div>

          <Card>
            <Tabs defaultValue="history">
              <div className="px-5 pt-2">
                <TabsList>
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="exits">Exit cases ({e.exitCases.length})</TabsTrigger>
                  <TabsTrigger value="given">Given, no return ({e.given.length})</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="history" className="p-5">
                <Timeline events={history.data?.items} loading={history.isLoading} showEntity />
              </TabsContent>
              <TabsContent value="exits">
                {!e.exitCases.length ? (
                  <EmptyState icon={LogOut} title="No exit cases" />
                ) : (
                  <ul className="divide-y">
                    {e.exitCases.map((x) => (
                      <li key={x.id}>
                        <Link to={`/exits/${x.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/50">
                          <span className="font-mono text-xs">{x.caseNumber}</span>
                          <span className="flex-1 text-muted-foreground">Last working day {formatDate(x.lastWorkingDate)}</span>
                          <EnumBadge value={x.status} tones={EXIT_CASE_TONE} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="given">
                {!e.given.length ? (
                  <EmptyState icon={Gift} title="Nothing given yet" description="One-time items like the joining kit show here — they’re theirs to keep." />
                ) : (
                  <ul className="divide-y">
                    {e.given.map((g) => (
                      <li key={g.allocationId} className="flex items-center gap-3 px-5 py-3 text-sm">
                        <AssetIcon icon={g.typeIcon ?? g.categoryIcon} color={g.categoryColor} size="sm" />
                        <Link to={`/assets/${g.assetId}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">
                          {g.quantity > 1 ? `${g.quantity} × ` : ''}
                          {g.name}
                        </Link>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Given {formatDate(g.assignedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </Card>

          <div className="lg:hidden">{profile}</div>
        </div>

        <div className="hidden space-y-5 lg:block">
          {idCard}
          {contact}
          {login}
          {profile}
        </div>
      </div>

      {statusOpen && <StatusDialog employee={e} open={statusOpen} onOpenChange={setStatusOpen} />}
      <AssetActionDialog dialog={dialog} onClose={() => setDialog(null)} onDone={() => void invalidateAssetData()} />
      <PickAssetDialog
        open={pickAsset}
        onOpenChange={setPickAsset}
        personName={e.fullName}
        onAddNew={(name) => {
          setPickAsset(false);
          // Let the dialog close before the form opens (both are modal).
          setTimeout(() => quickAdd.open('asset', { defaults: { holderType: 'EMPLOYEE', holderId: e.id, holderLabel: `${e.fullName} (${e.employeeCode})`, name: name || undefined } }), 150);
        }}
        onPick={(a) => {
          setPickAsset(false);
          setDialog({
            kind: 'assign',
            asset: { id: a.id, assetTag: a.assetTag, name: a.name, trackingMode: a.trackingMode, availableQuantity: a.availableQuantity },
            defaults: { holderType: 'EMPLOYEE', holderId: e.id },
          });
        }}
      />
      <CredentialsDialog employee={e} credentials={credentials} onClose={() => setCredentials(null)} />
      {accessOpen && <AccessDialog employee={e} saving={access.isPending} error={access.error} onSave={(body) => access.mutate(body)} onClose={() => setAccessOpen(false)} />}
    </div>
  );
}

/** The person's own QR: printed on their ID card, or shown on their phone for IT to scan. */
function IdCardPanel({ employee: e, self }: { employee: EmployeeDetail; self: boolean }) {
  const navigate = useNavigate();
  const links = useQrLinks();
  const { can } = useAuth();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{self ? 'My QR' : 'Person QR'}</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{self ? 'Show this to IT to check or return your assets.' : 'Scan with any phone camera or the app to open this page.'}</p>
        </div>
        {can('employee:view') && (
          <Button size="xs" variant="ghost" onClick={() => navigate(`/id-cards?ids=${e.id}`)}>
            <Printer /> ID card
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        {links.ready && <QRCode value={links.person(e.employeeCode)} size={self ? 200 : 164} className="border p-2" />}
        <p className="font-mono text-sm font-semibold">{e.employeeCode}</p>
        <p className="text-center text-xs text-muted-foreground">{e.fullName}</p>
        {!self && <LocalQrWarning className="mt-1" />}
      </CardContent>
    </Card>
  );
}

function ContactRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href: string }) {
  return (
    <a href={href} className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted active:bg-muted">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-medium">{value}</span>
      </span>
    </a>
  );
}

function ContactPanel({ employee: e }: { employee: EmployeeDetail }) {
  const rows = [
    e.phone && { icon: <Phone />, label: 'Official phone', value: e.phone, href: `tel:${e.phone.replace(/\s/g, '')}` },
    e.personalPhone && { icon: <Phone />, label: 'Personal phone', value: e.personalPhone, href: `tel:${e.personalPhone.replace(/\s/g, '')}` },
    e.email && { icon: <Mail />, label: 'Official email', value: e.email, href: `mailto:${e.email}` },
    e.personalEmail && { icon: <Mail />, label: 'Personal email', value: e.personalEmail, href: `mailto:${e.personalEmail}` },
  ].filter(Boolean) as { icon: ReactNode; label: string; value: string; href: string }[];
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>Contact</CardTitle>
      </CardHeader>
      <CardContent className="px-3">
        {rows.length ? (
          <div className="divide-y">
            {rows.map((r) => (
              <ContactRow key={r.label} {...r} />
            ))}
          </div>
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No phone or email recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

function LoginPanel({ employee: e, busy, onGrant, onDisable }: { employee: EmployeeDetail; busy: boolean; onGrant: () => void; onDisable: () => void }) {
  const { can } = useAuth();
  const manage = can('user:manage');
  const active = !!e.login?.isActive;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Portal login</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active ? (
              <>
                Signs in with{' '}
                {[e.login?.username, e.employeeCode, e.login?.email]
                  .filter(Boolean)
                  .map((v, i, all) => (
                    <span key={v}>
                      <span className="font-mono font-medium text-foreground">{v}</span>
                      {i < all.length - 1 ? ' or ' : ''}
                    </span>
                  ))}
              </>
            ) : e.login ? (
              'Login is turned off'
            ) : (
              'No login yet'
            )}
          </p>
        </div>
        {e.login && <Badge tone={active ? 'green' : 'neutral'} dot>{active ? e.login.roleName : 'Off'}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {e.login && (
          <p className="text-xs text-muted-foreground">Last sign-in: {e.login.lastLoginAt ? relativeTime(e.login.lastLoginAt) : 'never'}</p>
        )}
        {manage && e.status !== 'EXITED' && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Button variant={active ? 'outline' : 'default'} onClick={onGrant} loading={busy} className="h-11 sm:h-9">
              <KeyRound /> {active ? 'Change login / password' : e.login ? 'Turn login back on' : 'Give login (view only)'}
            </Button>
            {active && (
              <Button variant="ghost" onClick={onDisable} disabled={busy} className="h-11 sm:h-9">
                <ShieldOff /> Turn off
              </Button>
            )}
          </div>
        )}
        {!e.login && manage && <p className="text-xs text-muted-foreground">They’ll only see their own assets and QR. You choose the login ID and password.</p>}
      </CardContent>
    </Card>
  );
}

/** Step 1 of "Assign asset" from a person: choose an available asset. */
function PickAssetDialog({
  open,
  onOpenChange,
  onPick,
  onAddNew,
  personName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (a: AssetListItem) => void;
  onAddNew: (name: string) => void;
  personName: string;
}) {
  const { can } = useAuth();
  const [value, setValue] = useState<string | null>(null);
  const [picked, setPicked] = useState<AssetListItem | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign an asset to {personName}</DialogTitle>
          <DialogDescription>Pick one that’s available or in a store — or add a new one that isn’t in the system yet.</DialogDescription>
        </DialogHeader>
        <EntityPicker
          kind="asset"
          value={value}
          assetFilter={{ status: 'AVAILABLE,IN_INVENTORY' }}
          onAddNew={can('asset:create') ? onAddNew : undefined}
          onChange={async (v) => {
            setValue(v);
            setPicked(v ? await api.get<AssetListItem>(`/assets/${v}`) : null);
          }}
        />
        {can('asset:create') && (
          <button
            type="button"
            onClick={() => onAddNew('')}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary/40 p-3 text-left transition hover:bg-primary/5"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-medium">Add a new asset</span>
              <span className="block text-xs text-muted-foreground">Enter its details and it’s assigned to {personName} right away</span>
            </span>
          </button>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!picked} onClick={() => picked && onPick(picked)}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
