import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Gift,
  LogOut,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Printer,
  Undo2,
  UserPlus,
} from '@/components/icons';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { AssetStatusBadge, EmployeeStatusBadge, EnumBadge } from '@/components/common/badges';
import { LocalQrWarning, QRCode, useQrLinks } from '@/components/common/codes';
import { DetailList, EmptyState, ErrorState, PageLoader, BACK_LINK } from '@/components/common/page';
import { EntityPicker } from '@/features/assets/components/pickers';
import { Timeline } from '@/features/assets/components/timeline';
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
import { AssetActionDialog, type AssetDialog } from '@/features/assets/inventory/asset-actions';
import { useQuickAdd } from '@/features/assets/quick-add/quick-add';
import { ManageInPeople } from '@/features/admin/manage-in-people';
import { errorMessage } from '@kaampilot/core';
import { useAuth } from '@/features/assets/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { fetchAsset, useAssetsCache, useEmployee, useEmployeeHistory, useVerifyEmployeeAssets } from '@kaampilot/core/assets';
import { EXIT_CASE_TONE } from '@/lib/status';
import type { Allocation, AssetDetail, EmployeeDetail, HeldAsset } from '@kaampilot/core/assets';
import { cn, daysUntil, formatDate, formatDateTime, relativeTime } from '@/lib/utils';

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const quickAdd = useQuickAdd();
  const [dialog, setDialog] = useState<AssetDialog | null>(null);
  const [pickAsset, setPickAsset] = useState(false);
  const cache = useAssetsCache();
  const q = useEmployee(id);
  const history = useEmployeeHistory(id, !!q.data);

  const refresh = () => cache.invalidate(['employee', id], ['history', 'employee', id]);
  const verify = useVerifyEmployeeAssets({
    onSuccess: async () => {
      await refresh();
      toast.success('Marked as checked today');
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
  // Sign-in, roles, notice and switching off are Admin → People's (PLAN.md §26): shown here, changed there.
  const login = (can('user:manage') || e.login) && !self && <LoginPanel employee={e} />;
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
            ...(e.lastWorkingDate ? [{ label: 'Last working day', value: <span className={cn(lwd !== null && lwd <= 3 && 'font-medium text-warning')}>{formatDate(e.lastWorkingDate)}</span> }] : []),
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
                  <Link to={`/assets/employees/${r.id}`} className="flex items-center gap-2 text-sm hover:text-primary">
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
        <Link to="/assets/employees" className={BACK_LINK}>
          <ArrowLeft /> People &amp; assets
        </Link>
      )}

      {/* Who */}
      <Card className="relative overflow-hidden p-4 sm:p-5">
        <div className="relative flex items-start gap-3 sm:gap-4">
          <Avatar name={e.fullName} className="size-14 text-base ring-4 ring-primary/10 sm:size-16 sm:text-lg" />
          <div className="min-w-0 flex-1">
            {e.departmentName && <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{e.departmentName}</p>}
            <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words sm:text-[26px]">{e.fullName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.employeeCode}</span>
              <EmployeeStatusBadge status={e.status} />
              {e.designation && <span className="text-sm text-muted-foreground">{e.designation}</span>}
            </div>
            {(e.managerName || e.joinDate) && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {[e.managerName ? `Reports to ${e.managerName}` : null, e.joinDate ? `Joined ${formatDate(e.joinDate)}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {!self && <ManageInPeople className="mt-1.5" personId={e.login?.platformPersonId} query={e.email || e.employeeCode} />}
          </div>
          {canAssign && !exited && (
            <div className="hidden items-center gap-2 sm:flex">
              <Button onClick={() => setPickAsset(true)}>
                <UserPlus /> Assign asset
              </Button>
              <Button variant="outline" onClick={() => verify.mutate(e.id)} loading={verify.isPending}>
                <ClipboardCheck /> Mark checked
              </Button>
            </div>
          )}
          {can('employee:manage') && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => quickAdd.open('employee', { record: e })}>
                  <Pencil /> Edit Assets details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {canAssign && !exited && (
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:hidden">
            <Button onClick={() => setPickAsset(true)} className="h-11">
              <UserPlus /> Assign asset
            </Button>
            <Button variant="outline" onClick={() => verify.mutate(e.id)} loading={verify.isPending} className="h-11">
              <ClipboardCheck /> Mark checked
            </Button>
          </div>
        )}
      </Card>

      {e.status === 'JOINING' && e.onboarding && (
        <Link
          to={`/assets/onboarding/${e.onboarding.id}`}
          className="flex items-center gap-3 rounded-xl border border-app-attendance/25 bg-app-attendance/8 px-4 py-3 text-sm text-app-attendance transition hover:border-app-attendance/40"
        >
          <UserPlus className="size-4 shrink-0" />
          <span className="flex-1">
            New joiner — joining <span className="font-semibold">{formatDate(e.onboarding.joinDate)}</span>. Onboarding {e.onboarding.caseNumber} →
          </span>
        </Link>
      )}

      {e.openExitCase && (
        <Link
          to={`/assets/exits/${e.openExitCase.id}`}
          className="flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning transition hover:border-warning/40"
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
                <p className={cn('mt-0.5 flex items-center gap-1 text-xs', e.assetsVerifiedAt ? 'text-success' : 'text-muted-foreground')}>
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
                  <Link to={`/assets/assets?employeeId=${e.id}`}>
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
                      <Link to={`/assets/assets/${h.assetId}`} className="flex items-center gap-3 p-3">
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
                        <Link to={`/assets/exits/${x.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/50">
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
                        <Link to={`/assets/assets/${g.assetId}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">
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

      <AssetActionDialog dialog={dialog} onClose={() => setDialog(null)} onDone={() => void cache.invalidateAssetData()} />
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
          <Button size="xs" variant="ghost" onClick={() => navigate(`/assets/id-cards?ids=${e.id}`)}>
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
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/8 text-primary [&_svg]:size-4">{icon}</span>
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

function LoginPanel({ employee: e }: { employee: EmployeeDetail }) {
  const active = !!e.login?.isActive;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sign-in</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{active ? 'Signs in with Kaampilot' : e.login ? 'Switched off' : 'No login yet'}</p>
        </div>
        {e.login && <Badge tone={active ? 'green' : 'neutral'}>{active ? e.login.roleName : 'Off'}</Badge>}
      </CardHeader>
      <CardContent className="space-y-2">
        {e.login && <p className="text-xs text-muted-foreground">Last sign-in: {e.login.lastLoginAt ? relativeTime(e.login.lastLoginAt) : 'never'}</p>}
        <p className="text-xs text-muted-foreground">Logins, roles, notice and switching off are managed in Admin → People.</p>
        <ManageInPeople personId={e.login?.platformPersonId} query={e.email || e.employeeCode} />
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
  onPick: (a: AssetDetail) => void;
  onAddNew: (name: string) => void;
  personName: string;
}) {
  const { can } = useAuth();
  const [value, setValue] = useState<string | null>(null);
  const [picked, setPicked] = useState<AssetDetail | null>(null);
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
            setPicked(v ? await fetchAsset(v) : null);
          }}
        />
        {can('asset:create') && (
          <button
            type="button"
            onClick={() => onAddNew('')}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary/40 p-3 text-left transition hover:bg-primary/5"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
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
