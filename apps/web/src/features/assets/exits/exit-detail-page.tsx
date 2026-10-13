import { EXIT_ITEM_STATUSES, type ExitItemStatus, humanize } from '@eam/shared';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Lock, Plus, ScanLine, ShieldAlert, Undo, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmployeeStatusBadge, EnumBadge } from '@/components/common/badges';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { EmptyState, ErrorState, PageLoader } from '@/components/common/page';
import { Timeline } from '@/features/assets/components/timeline';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { CameraScanner } from '@/features/assets/inventory/scan-page';
import { ApiError, errorMessage } from '@freefounders/core';
import { useAuth } from '@/features/assets/lib/auth';
import { useScannerInput } from '@/lib/hotkeys';
import { useAddExitItem, useAssetsCache, useCancelExit, useCompleteExit, useExitCase, useExitHistory, useOverrideExit, useScanExitItem, useUpdateExitItem } from '@freefounders/core/assets';
import { EXIT_CASE_TONE, EXIT_ITEM_TONE } from '@/lib/status';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { DaysLeft } from './exits-page';

const ITEM_BUTTON: Record<ExitItemStatus, string> = {
  PENDING: 'data-[on=true]:bg-warning/12 data-[on=true]:text-warning dark:data-[on=true]:bg-warning/15 dark:data-[on=true]:text-warning',
  RETURNED: 'data-[on=true]:bg-success/12 data-[on=true]:text-success dark:data-[on=true]:bg-success/15 dark:data-[on=true]:text-success',
  DAMAGED: 'data-[on=true]:bg-warning/12 data-[on=true]:text-warning dark:data-[on=true]:bg-warning/15 dark:data-[on=true]:text-warning',
  MISSING: 'data-[on=true]:bg-destructive/12 data-[on=true]:text-destructive dark:data-[on=true]:bg-destructive/15 dark:data-[on=true]:text-destructive',
};

const EXIT_ITEM_BAR: Record<'RETURNED' | 'DAMAGED' | 'PENDING' | 'MISSING', string> = { RETURNED: 'bg-success', DAMAGED: 'bg-app-admin', PENDING: 'bg-warning', MISSING: 'bg-destructive' };

export default function ExitDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [scan, setScan] = useState('');
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const cache = useAssetsCache();
  const q = useExitCase(id);
  const history = useExitHistory(id, !!q.data);

  const refresh = () => cache.invalidateAssetData();
  const updateItem = useUpdateExitItem({
    onSuccess: async (_d, v) => {
      await refresh();
      toast.success(`${v.item.assetTag ?? v.item.assetName}: ${humanize(v.status).toLowerCase()}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const scanMut = useScanExitItem({
    onSuccess: async (r) => {
      setScan('');
      await refresh();
      if (r.alreadyCleared) toast.info(`${r.item.assetTag ?? r.item.assetName} was already cleared`);
      else toast.success(`Returned: ${r.item.assetTag} ${r.item.assetName}`);
      scanRef.current?.focus();
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      scanRef.current?.select();
    },
  });
  const complete = useCompleteExit({
    onSuccess: async () => {
      await refresh();
      toast.success('Exit completed — all assets cleared');
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  });
  const override = useOverrideExit({
    onSuccess: async () => {
      await refresh();
      toast.success('Exit completed with authorised override');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useCancelExit({
    onSuccess: async () => {
      await refresh();
      toast.success('Notice withdrawn — exit cancelled');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const x = q.data;
  const open = x?.status === 'OPEN';
  const manage = can('exit:manage') && open;
  // USB scanner bursts go straight to scan-to-return on this page.
  useScannerInput((code) => {
    if (manage) scanMut.mutate({ caseId: id!, code });
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !x) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pct = x.counts.total ? Math.round((x.counts.cleared / x.counts.total) * 100) : 100;
  const blocking = x.counts.pending + x.counts.missing;

  const askOverride = async () => {
    const list = x.items.filter((i) => i.status === 'PENDING' || i.status === 'MISSING');
    const r = await confirm({
      title: 'Complete exit with override',
      destructive: true,
      confirmText: 'Override & complete exit',
      description: (
        <div className="space-y-2">
          <p>These {list.length} item(s) are not cleared. They will be written off as lost and the override is recorded permanently with your name:</p>
          <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-foreground">
            {list.map((i) => (
              <li key={i.id}>
                {i.assetTag ? `${i.assetTag} · ` : ''}
                {i.assetName} ({humanize(i.status).toLowerCase()})
              </li>
            ))}
          </ul>
        </div>
      ),
      note: { label: 'Reason for override', placeholder: 'e.g. Laptop cost recovered from full & final settlement', required: true, minLength: 10 },
    });
    if (r.confirmed) override.mutate({ caseId: id!, reason: r.note });
  };

  const askCancel = async () => {
    const r = await confirm({
      title: 'Withdraw notice?',
      description: `${x.employee.fullName} goes back to Active and this checklist is cancelled. Assets stay with them.`,
      confirmText: 'Withdraw notice',
      note: { label: 'Reason', placeholder: 'Resignation withdrawn…' },
    });
    if (r.confirmed) cancel.mutate({ caseId: id!, reason: r.note });
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/assets/exits" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Exits
        </Link>
        <Card className="relative overflow-hidden p-4 sm:p-5">
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={x.employee.fullName} className="size-14 text-base ring-4 ring-warning/15" />
            <div>
              <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Exit clearance · {x.caseNumber}</p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                <Link to={`/assets/employees/${x.employee.id}`} className="hover:text-primary">
                  {x.employee.fullName}
                </Link>
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <EnumBadge value={x.status} tones={EXIT_CASE_TONE} />
                <EmployeeStatusBadge status={x.employee.status} />
                <span>
                  {x.employee.employeeCode} · {x.employee.designation ?? '—'}
                  {x.employee.departmentName ? ` · ${x.employee.departmentName}` : ''}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-xl border bg-muted/30 px-4 py-3">
            <div>
              <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Last working day</p>
              <p className="font-mono text-lg font-semibold">{formatDate(x.lastWorkingDate)}</p>
            </div>
            {open && <DaysLeft date={x.lastWorkingDate} className="text-sm" />}
          </div>
          </div>
        </Card>
      </div>

      {x.status === 'COMPLETED' && (
        <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', x.overridden ? 'border-destructive/25 bg-destructive/8 text-destructive' : 'border-success/25 bg-success/8 text-success')}>
          {x.overridden ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <div>
            <p className="font-medium">
              Exit completed {formatDateTime(x.completedAt)} by {x.completedByName}
              {x.overridden ? ' — with authorised override' : ' — all assets cleared'}
            </p>
            {x.overrideReason && <p className="mt-0.5">Reason: {x.overrideReason}</p>}
          </div>
        </div>
      )}
      {x.status === 'CANCELLED' && (
        <div className="flex items-center gap-3 rounded-xl border bg-muted/50 px-4 py-3 text-sm">
          <XCircle className="size-4" /> This exit was cancelled {formatDateTime(x.cancelledAt)} (notice withdrawn).
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card className="relative overflow-hidden p-4 sm:col-span-2">
          <div className="relative flex items-end justify-between">
            <div>
              <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Recovery progress</p>
              <p className="mt-1.5 font-mono text-[28px] leading-none font-semibold tabular">
                {x.counts.cleared} <span className="font-sans text-base font-normal text-muted-foreground">of {x.counts.total} cleared</span>
              </p>
            </div>
            <span className={cn('font-mono text-2xl font-semibold tabular', blocking ? 'text-warning' : 'text-success')}>{pct}%</span>
          </div>
          <Progress value={pct} className="relative mt-3 h-2" indicatorClassName={blocking ? 'bg-warning' : 'bg-success'} />
        </Card>
        {(['RETURNED', 'DAMAGED', 'PENDING', 'MISSING'] as const).map((s) => {
          const n = x.counts[s.toLowerCase() as 'returned'];
          const tone = s === 'MISSING' && n ? 'text-destructive' : s === 'PENDING' && n ? 'text-warning' : s === 'DAMAGED' && n ? 'text-app-admin' : s === 'RETURNED' && n ? 'text-success' : '';
          return (
            <Card key={s} className="flex flex-col justify-between p-4">
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                <span className={cn('size-1.5 rounded-full', EXIT_ITEM_BAR[s])} aria-hidden />
                {humanize(s)}
              </p>
              <p className={cn('mt-1.5 font-mono text-[28px] leading-none font-semibold tabular', tone)}>{n}</p>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {manage && (
            <Card>
              <CardContent className="pt-5">
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (scan.trim()) scanMut.mutate({ caseId: id!, code: scan.trim() });
                  }}
                >
                  <div className="relative min-w-full flex-1 sm:min-w-0">
                    <ScanLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan or type an asset tag / serial to mark it returned…" className="h-10 pl-9 font-mono" />
                  </div>
                  <Button type="submit" className="h-10 flex-1 sm:flex-none" loading={scanMut.isPending}>
                    Mark returned
                  </Button>
                  <Button type="button" variant="outline" className="h-10" onClick={() => setCamera((c) => !c)} aria-label="Use camera">
                    <Camera />
                  </Button>
                </form>
                {camera && <CameraScanner className="mt-3" onCode={(c) => scanMut.mutate({ caseId: id!, code: c })} />}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="size-4" /> Asset recovery checklist
                </CardTitle>
                <p className="text-xs text-muted-foreground">Built automatically from every asset assigned to {x.employee.fullName}.</p>
              </div>
              {manage && (
                <Button size="xs" variant="outline" onClick={() => setManual(true)}>
                  <Plus /> Add item
                </Button>
              )}
            </CardHeader>
            {!x.items.length ? (
              <EmptyState icon={CheckCircle2} title="Nothing to recover" description="This employee held no assets." className="py-8" />
            ) : (
              <ul className="divide-y border-t">
                {x.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {item.assetId ? (
                          <Link to={`/assets/assets/${item.assetId}`} className="truncate font-medium hover:text-primary">
                            {item.assetName}
                          </Link>
                        ) : (
                          <span className="truncate font-medium">{item.assetName}</span>
                        )}
                        {item.quantity > 1 && <Badge tone="outline">×{item.quantity}</Badge>}
                        {item.source === 'ADDED_LATER' && <Badge tone="violet">Added during notice</Badge>}
                        {item.source === 'MANUAL' && <Badge tone="gray">Manual</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.assetTag && <span className="font-mono">{item.assetTag}</span>}
                        {item.assetTypeName && ` · ${item.assetTypeName}`}
                        {item.serialNumber && ` · SN ${item.serialNumber}`}
                      </p>
                      {(item.resolvedAt || item.notes) && item.status !== 'PENDING' && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {humanize(item.status)} {item.resolvedByName ? `by ${item.resolvedByName}` : ''} {item.resolvedAt ? `· ${formatDateTime(item.resolvedAt)}` : ''}
                          {item.notes ? ` — ${item.notes}` : ''}
                        </p>
                      )}
                    </div>
                    {manage ? (
                      <div className="grid w-full shrink-0 grid-cols-4 rounded-lg bg-muted p-0.5 sm:flex sm:w-auto">
                        {EXIT_ITEM_STATUSES.map((s) => {
                          const on = item.status === s;
                          const locked = item.allocationStatus && item.allocationStatus !== 'ACTIVE' && (s === 'PENDING' || s === 'MISSING');
                          return (
                            <button
                              key={s}
                              type="button"
                              data-on={on}
                              disabled={on || !!locked || updateItem.isPending}
                              onClick={() => updateItem.mutate({ caseId: id!, item, status: s })}
                              className={cn(
                                'cursor-pointer rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition enabled:hover:text-foreground disabled:cursor-default data-[on=true]:shadow-sm sm:px-2.5',
                                !on && locked && 'opacity-40',
                                ITEM_BUTTON[s],
                              )}
                            >
                              {humanize(s)}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <EnumBadge value={item.status} tones={EXIT_ITEM_TONE} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <Tabs defaultValue="history">
              <div className="px-5 pt-2">
                <TabsList>
                  <TabsTrigger value="history">Case history</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="history" className="p-5">
                <Timeline events={history.data?.items} loading={history.isLoading} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Complete exit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {open ? (
                <>
                  {blocking > 0 ? (
                    <div className="flex gap-2.5 rounded-lg border border-warning/25 bg-warning/8 p-3 text-sm text-warning">
                      <Lock className="mt-0.5 size-4 shrink-0" />
                      <p>
                        Blocked: <span className="font-semibold">{x.counts.pending}</span> pending and <span className="font-semibold">{x.counts.missing}</span> missing. Recover them, or record an authorised override.
                      </p>
                    </div>
                  ) : (
                    <div className="flex gap-2.5 rounded-lg border border-success/25 bg-success/8 p-3 text-sm text-success">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                      <p>All assets are cleared. You can complete the exit.</p>
                    </div>
                  )}
                  {can('exit:manage') && (
                    <Button
                      className="w-full"
                      variant={blocking ? 'outline' : 'success'}
                      loading={complete.isPending}
                      onClick={() => complete.mutate(id!)}
                    >
                      <CheckCircle2 /> Complete exit
                    </Button>
                  )}
                  {can('exit:override') && blocking > 0 && (
                    <Button className="w-full" variant="destructive" loading={override.isPending} onClick={askOverride}>
                      <ShieldAlert /> Override & complete…
                    </Button>
                  )}
                  {can('employee:status') && (
                    <Button className="w-full" variant="ghost" loading={cancel.isPending} onClick={askCancel}>
                      <Undo /> Withdraw notice
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">Completing marks {x.employee.fullName} as Exited and disables their portal login.</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">This case is closed.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Notice given:</span> {formatDate(x.noticeDate)}
              </p>
              <p>
                <span className="text-muted-foreground">Initiated by:</span> {x.initiatedByName ?? '—'} · {formatDate(x.createdAt)}
              </p>
              {x.reason && (
                <p>
                  <span className="text-muted-foreground">Reason:</span> {x.reason}
                </p>
              )}
              {x.employee.email && (
                <p>
                  <span className="text-muted-foreground">Email:</span> {x.employee.email}
                </p>
              )}
            </CardContent>
          </Card>
          {blocking > 0 && open && !can('exit:override') && (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" /> Only HR / Admin can override uncleared items.
            </p>
          )}
        </div>
      </div>

      <ManualItemDialog caseId={x.id} open={manual} onOpenChange={setManual} />
    </div>
  );
}

function ManualItemDialog({ caseId, open, onOpenChange }: { caseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const cache = useAssetsCache();
  const add = useAddExitItem({
    onSuccess: async () => {
      await cache.invalidateAssetData();
      toast.success('Item added to checklist');
      setName('');
      setNotes('');
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : errorMessage(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add checklist item</DialogTitle>
          <DialogDescription>For anything not tracked as an asset (e.g. uniform, petty cash card).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Item" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate({ caseId, assetName: name, notes })}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
