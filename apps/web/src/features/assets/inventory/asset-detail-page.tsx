import { availableActions, humanize, LIFECYCLE, LIFECYCLE_STAGES, type LifecycleAction } from '@eam/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  Check,
  Copy,
  LifeBuoy,
  LogOut,
  MoreHorizontal,
  Pencil,
  Printer,
  Undo2,
  UserPlus,
  Wrench,
} from '@/components/icons';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AssetStatusBadge, ConditionBadge, EnumBadge, HolderLabel } from '@/components/common/badges';
import { Barcode, QRCode, useQrLinks } from '@/components/common/codes';
import { AttributeList } from '@/features/assets/components/dynamic-fields';
import { DetailList, EmptyState, ErrorState, PageLoader } from '@/components/common/page';
import { Timeline } from '@/features/assets/components/timeline';
import { PhotoStrip } from '@/features/assets/components/photos';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Badge, Card, CardContent, CardHeader, CardTitle, Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useQuickAdd } from '@/features/assets/quick-add/quick-add';
import { useAsset, useAssetAllocations, useAssetHistory, useAssetMaintenance, useAssetOwnership } from '@freefounders/core/assets';
import { useAuth } from '@/features/assets/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { MAINTENANCE_TONE } from '@/lib/status';
import type { Allocation } from '@freefounders/core/assets';
import { cn, daysUntil, formatDate, formatDateTime, formatMoney, relativeTime } from '@/lib/utils';
import { AssetActionDialog, type AssetDialog } from './asset-actions';

const PRIMARY: LifecycleAction[] = ['assign', 'transfer', 'return'];

export default function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const quickAdd = useQuickAdd();
  const [dialog, setDialog] = useState<AssetDialog | null>(null);
  const [copied, setCopied] = useState(false);
  const links = useQrLinks();

  const q = useAsset(id);
  const history = useAssetHistory(id, !!q.data);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const pooled = a.trackingMode === 'QUANTITY';
  const actions = availableActions({ status: a.status, trackingMode: a.trackingMode, availableQuantity: a.availableQuantity, activeAllocations: a.activeAllocations.length }).filter(
    (x) => can(LIFECYCLE[x].permission) && x !== 'complete_maintenance',
  );
  const primary = actions.filter((x) => PRIMARY.includes(x));
  const secondary = actions.filter((x) => !PRIMARY.includes(x));
  const consumable = !!a.type.consumable;
  const actionAsset = { id: a.id, assetTag: a.assetTag, name: a.name, trackingMode: a.trackingMode, availableQuantity: a.availableQuantity, holderType: a.holderType, holderName: a.holderName, consumable };

  const runAction = (action: LifecycleAction, allocation?: Allocation) => {
    if (action === 'assign') setDialog({ kind: 'assign', asset: actionAsset });
    else if (action === 'transfer') setDialog({ kind: 'transfer', asset: actionAsset, allocation: allocation ?? a.activeAllocations[0] });
    else if (action === 'return') setDialog({ kind: 'return', asset: actionAsset, allocation: allocation ?? a.activeAllocations[0] });
    else if (action === 'start_maintenance') quickAdd.open('maintenance', { defaults: { assetId: a.id, assetLabel: `${a.assetTag} · ${a.name}` } });
    else setDialog({ kind: 'lifecycle', asset: actionAsset, action });
  };

  const stageIndex = LIFECYCLE_STAGES.findIndex((s) => s.statuses.includes(a.status));
  const warrantyDays = daysUntil(a.warrantyExpiry);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link to="/assets/assets" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Assets
        </Link>
        <Card className="relative overflow-hidden p-4 sm:p-5">
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <AssetIcon icon={a.type.icon ?? a.category.icon} color={a.category.color} size="xl" className="hidden sm:inline-flex" />
            <AssetIcon icon={a.type.icon ?? a.category.icon} color={a.category.color} size="lg" className="sm:hidden" />
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {a.category.name} · {a.type.name}
              </p>
              <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight sm:text-2xl">{a.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-accent"
                  onClick={() => {
                    void navigator.clipboard?.writeText(a.assetTag);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  title="Copy asset tag"
                >
                  {a.assetTag} {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                </button>
                <AssetStatusBadge status={a.status} />
                <ConditionBadge condition={a.condition} />
                {a.serialNumber && <span className="font-mono text-xs">SN {a.serialNumber}</span>}
                {pooled && <Badge tone="cyan">Tracked by quantity</Badge>}
                {consumable && <Badge tone="green">One-time — no return</Badge>}
              </div>
              {(a.holderName || a.manufacturer || a.model) && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {(a.manufacturer || a.model) && <span className="text-muted-foreground">{[a.manufacturer, a.model].filter(Boolean).join(' ')}</span>}
                  {a.holderName && !pooled && <HolderLabel type={a.holderType} name={a.holderName} className="font-medium" />}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {primary.map((x) => {
              const Icon = x === 'assign' ? UserPlus : x === 'transfer' ? ArrowRightLeft : Undo2;
              return (
                <Button key={x} size="sm" variant={x === 'assign' ? 'default' : 'outline'} onClick={() => runAction(x)} disabled={pooled && x !== 'assign' && a.activeAllocations.length > 1}>
                  <Icon /> {consumable && x === 'assign' ? 'Give' : LIFECYCLE[x].label}
                  {pooled && x === 'assign' && !consumable ? ' units' : ''}
                </Button>
              );
            })}
            {can('asset:edit') && (
              <Button size="sm" variant="outline" onClick={() => quickAdd.open('asset', { record: a })}>
                <Pencil /> Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {secondary.length > 0 && <DropdownMenuLabel>Lifecycle</DropdownMenuLabel>}
                {secondary.map((x) => (
                  <DropdownMenuItem key={x} destructive={LIFECYCLE[x].tone === 'danger'} onSelect={() => runAction(x)}>
                    {x === 'start_maintenance' && <Wrench />}
                    {LIFECYCLE[x].label}
                  </DropdownMenuItem>
                ))}
                {secondary.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => navigate(`/assets/labels?ids=${a.id}`)}>
                  <Printer /> Print label
                </DropdownMenuItem>
                {can('ticket:create') && (
                  <DropdownMenuItem onSelect={() => quickAdd.open('ticket', { defaults: { assetId: a.id, assetLabel: `${a.assetTag} · ${a.name}` } })}>
                    <LifeBuoy /> Raise a ticket
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          </div>
        </Card>
      </div>

      {/* Alerts */}
      {a.openExits.map((x) => (
        <Link key={x.id} to={`/assets/exits/${x.id}`} className="flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning transition hover:border-warning/40">
          <LogOut className="size-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium">{x.employeeName}</span> is on notice — this asset is on exit checklist {x.caseNumber} (last working day {formatDate(x.lastWorkingDate)}).
          </span>
          <span className="text-xs font-medium">Open checklist →</span>
        </Link>
      ))}
      {a.openMaintenance.map((m) => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-warning">
          <Wrench className="size-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium">{m.number}</span> {m.status === 'SCHEDULED' ? `scheduled${m.scheduledDate ? ` for ${formatDate(m.scheduledDate)}` : ''}` : 'in progress'}: {m.title}
          </span>
          <Link to="/assets/maintenance" className="text-xs font-medium">
            Manage →
          </Link>
        </div>
      ))}
      {a.status === 'LOST' && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> This asset is marked lost. Mark it found if it turns up, or dispose of it to write it off.
        </div>
      )}

      {/* Lifecycle stepper */}
      <Card className="no-scrollbar overflow-x-auto px-4 pt-3 pb-4">
        <p className="mb-3 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Lifecycle</p>
        <ol className="flex min-w-[720px] items-center">
          {LIFECYCLE_STAGES.map((s, i) => {
            const done = stageIndex >= 0 && i < stageIndex;
            const current = i === stageIndex;
            return (
              <li key={s.key} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border-2 text-xs font-semibold',
                      current ? (a.status === 'LOST' ? 'border-destructive bg-destructive text-white ring-4 ring-destructive/15 dark:text-background' : 'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15') : done ? 'border-primary/60 bg-primary/8 text-primary' : 'border-border text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className={cn('whitespace-nowrap text-xs', current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{current && a.status === 'LOST' ? 'Lost' : s.label}</span>
                </div>
                {i < LIFECYCLE_STAGES.length - 1 && <span className={cn('mx-1 mb-5 h-0.5 flex-1 rounded', done ? 'bg-primary/50' : 'bg-border')} />}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{a.type.name} specifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <AttributeList fields={a.fields} attributes={a.attributes} emptyText={`No custom fields defined for ${a.type.name}. Add them in the asset catalog.`} />
              {a.archivedFields.length > 0 && (
                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Archived fields (kept for history)</p>
                  <AttributeList fields={a.archivedFields} attributes={a.attributes} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                columns={3}
                items={[
                  { label: 'Serial number', value: a.serialNumber && <span className="font-mono">{a.serialNumber}</span> },
                  { label: 'Manufacturer', value: a.manufacturer },
                  { label: 'Model', value: a.model },
                  { label: 'Ownership', value: humanize(a.ownership) },
                  { label: 'Vendor', value: a.vendorName },
                  { label: 'Purchase date', value: a.purchaseDate && formatDate(a.purchaseDate) },
                  { label: 'Invoice', value: a.invoiceNumber },
                  {
                    label: 'Warranty / expiry',
                    value: a.warrantyExpiry && (
                      <span className={cn(warrantyDays !== null && warrantyDays < 0 && 'text-muted-foreground', warrantyDays !== null && warrantyDays >= 0 && warrantyDays <= 30 && 'font-medium text-warning')}>
                        {formatDate(a.warrantyExpiry)} {warrantyDays !== null && <span className="text-xs">({warrantyDays < 0 ? 'expired' : `${warrantyDays} days left`})</span>}
                      </span>
                    ),
                  },
                  { label: 'Added', value: formatDate(a.createdAt) },
                  ...(a.description ? [{ label: 'Notes', value: a.description, full: true }] : []),
                  ...(a.photos.length ? [{ label: 'Photos', value: <PhotoStrip photos={a.photos} />, full: true }] : []),
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <Tabs defaultValue="timeline">
              <div className="px-5 pt-2">
                <TabsList>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="assignments">Assignments</TabsTrigger>
                  <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
                  <TabsTrigger value="ownership">Ownership</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="timeline" className="p-5">
                <Timeline events={history.data?.items} loading={history.isLoading} />
              </TabsContent>
              <TabsContent value="assignments">
                <AllocationHistory assetId={a.id} />
              </TabsContent>
              <TabsContent value="maintenance">
                <MaintenanceHistory assetId={a.id} />
              </TabsContent>
              <TabsContent value="ownership">
                <OwnershipHistory assetId={a.id} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{consumable ? 'Stock' : pooled ? 'Stock & allocations' : 'Custody'}</CardTitle>
            </CardHeader>
            <CardContent>
              {pooled ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-semibold tabular">{a.availableQuantity}</span>
                      <span className="text-xs text-muted-foreground">{consumable ? `left of ${a.quantity}` : `of ${a.quantity} available`}</span>
                    </div>
                    <Progress value={a.quantity ? (a.availableQuantity / a.quantity) * 100 : 0} className="mt-2" indicatorClassName="bg-success" />
                  </div>
                  {a.activeAllocations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{consumable ? 'Given items are kept by the person — see Assignments for who got one.' : 'No units issued.'}</p>
                  ) : (
                    <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin">
                      {a.activeAllocations.map((al) => (
                        <li key={al.id} className="flex items-center gap-2 py-2">
                          <div className="min-w-0 flex-1">
                            <HolderLabel type={al.holderType} name={al.holderName} className="text-sm" />
                            <p className="text-xs text-muted-foreground">
                              ×{al.quantity} · since {formatDate(al.assignedAt)}
                            </p>
                            <PhotoStrip photos={al.photos} size="sm" className="mt-1" />
                          </div>
                          {can('asset:assign') && (
                            <>
                              <Button size="icon-xs" variant="ghost" title="Transfer" onClick={() => runAction('transfer', al)}>
                                <ArrowRightLeft />
                              </Button>
                              <Button size="icon-xs" variant="ghost" title="Return" onClick={() => runAction('return', al)}>
                                <Undo2 />
                              </Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : a.activeAllocations[0] ? (
                (() => {
                  const al = a.activeAllocations[0];
                  const link = al.employeeId ? `/assets/employees/${al.employeeId}` : null;
                  return (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-info/25 bg-info/8 p-3">
                        <p className="font-mono text-[11px] font-medium tracking-wider text-info uppercase">{al.holderType === 'INVENTORY' ? 'In store at' : `Assigned to (${humanize(al.holderType).toLowerCase()})`}</p>
                        {link ? (
                          <Link to={link} className="mt-1 block font-medium hover:text-primary hover:underline">
                            <HolderLabel type={al.holderType} name={al.holderName} />
                          </Link>
                        ) : (
                          <HolderLabel type={al.holderType} name={al.holderName} className="mt-1 font-medium" />
                        )}
                      </div>
                      <DetailList
                        columns={1}
                        items={[
                          { label: 'Since', value: `${formatDateTime(al.assignedAt)} (${relativeTime(al.assignedAt)})` },
                          { label: 'By', value: al.assignedByName },
                          ...(al.expectedReturnDate ? [{ label: 'Expected back', value: formatDate(al.expectedReturnDate) }] : []),
                          ...(al.notes ? [{ label: 'Notes', value: al.notes }] : []),
                        ]}
                      />
                      {!!al.photos?.length && (
                        <div>
                          <p className="mb-1.5 text-xs text-muted-foreground">Handover photos</p>
                          <PhotoStrip photos={al.photos} />
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <EmptyState
                  title="Not assigned"
                  description={a.status === 'AVAILABLE' ? 'Ready to hand out.' : `Status: ${humanize(a.status)}`}
                  className="py-6"
                  action={
                    actions.includes('assign') ? (
                      <Button size="sm" onClick={() => runAction('assign')}>
                        <UserPlus /> Assign
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Label</CardTitle>
              <Button size="xs" variant="ghost" onClick={() => navigate(`/assets/labels?ids=${a.id}`)}>
                <Printer /> Print
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              {links.ready && (
                <div className="rounded-2xl border bg-primary/4 p-3">
                  <QRCode value={links.asset(a.qrCode)} size={148} className="rounded-lg border bg-white p-1.5" />
                </div>
              )}
              <Barcode value={a.assetTag} height={34} className="text-foreground dark:invert" />
              <p className="font-mono text-sm font-semibold">{a.assetTag}</p>
              <p className="text-center text-xs text-muted-foreground">Scan with a phone camera or a USB scanner to open this asset.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <AssetActionDialog dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function AllocationHistory({ assetId }: { assetId: string }) {
  const q = useAssetAllocations(assetId);
  if (q.isLoading) return <div className="p-5 text-sm text-muted-foreground">Loading…</div>;
  if (!q.data?.length) return <EmptyState title="Never assigned" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Holder</TH>
          <TH>From</TH>
          <TH>To</TH>
          <TH>Outcome</TH>
          <TH>Photos</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.map((al) => (
          <TR key={al.id}>
            <TD>
              <HolderLabel type={al.holderType} name={al.holderName} />
              {al.quantity > 1 && <span className="ml-1 text-xs text-muted-foreground">×{al.quantity}</span>}
            </TD>
            <TD className="whitespace-nowrap text-muted-foreground">{formatDate(al.assignedAt)}</TD>
            <TD className="whitespace-nowrap text-muted-foreground">{al.endedAt ? formatDate(al.endedAt) : '—'}</TD>
            <TD>
              {al.status === 'ACTIVE' ? (
                <Badge tone="blue">
                  Current
                </Badge>
              ) : (
                <span className="text-xs">
                  {al.status === 'CONSUMED' ? 'Given (no return)' : humanize(al.status)}
                  {al.returnCondition ? ` · ${humanize(al.returnCondition).toLowerCase()}` : ''}
                  {al.endNotes ? <span className="block text-muted-foreground">{al.endNotes}</span> : null}
                </span>
              )}
            </TD>
            <TD>{al.photos?.length ? <PhotoStrip photos={al.photos} size="sm" className="min-w-24" /> : <span className="text-muted-foreground">—</span>}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function MaintenanceHistory({ assetId }: { assetId: string }) {
  const q = useAssetMaintenance(assetId);
  if (q.isLoading) return <div className="p-5 text-sm text-muted-foreground">Loading…</div>;
  if (!q.data?.items.length) return <EmptyState icon={Wrench} title="No maintenance recorded" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Record</TH>
          <TH>Type</TH>
          <TH>Status</TH>
          <TH>Cost</TH>
          <TH>Date</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.items.map((m) => (
          <TR key={m.id}>
            <TD>
              <div className="font-medium">{m.title}</div>
              <div className="text-xs text-muted-foreground">
                {m.number}
                {m.vendorName ? ` · ${m.vendorName}` : ''}
              </div>
            </TD>
            <TD className="text-muted-foreground">{humanize(m.type)}</TD>
            <TD>
              <EnumBadge value={m.status} tones={MAINTENANCE_TONE} />
            </TD>
            <TD className="tabular">{formatMoney(m.cost)}</TD>
            <TD className="whitespace-nowrap text-muted-foreground">{formatDate(m.completedAt ?? m.startedAt ?? m.scheduledDate ?? m.createdAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function OwnershipHistory({ assetId }: { assetId: string }) {
  const q = useAssetOwnership(assetId);
  if (q.isLoading) return <div className="p-5 text-sm text-muted-foreground">Loading…</div>;
  if (!q.data?.length) return <EmptyState title="No ownership records" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Ownership</TH>
          <TH>Owner company</TH>
          <TH>Vendor / lessor</TH>
          <TH>Period</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.map((o) => (
          <TR key={o.id}>
            <TD>{humanize(o.ownership)}</TD>
            <TD>{o.ownerCompanyName ?? '—'}</TD>
            <TD>{o.vendorName ?? '—'}</TD>
            <TD className="whitespace-nowrap text-muted-foreground">
              {formatDate(o.startedAt)} – {o.endedAt ? formatDate(o.endedAt) : 'now'}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
