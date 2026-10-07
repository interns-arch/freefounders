import { EXIT_ITEM_STATUSES, type ExitItemStatus, humanize } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Lock, Plus, ScanLine, ShieldAlert, Undo, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmployeeStatusBadge, EnumBadge } from '@/components/common/badges';
import { useConfirm } from '@/components/common/confirm';
import { Field } from '@/components/common/form';
import { EmptyState, ErrorState, PageLoader } from '@/components/common/page';
import { Timeline } from '@/components/common/timeline';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { CameraScanner } from '@/features/assets/scan-page';
import { api, ApiError, errorMessage, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useScannerInput } from '@/lib/hotkeys';
import { invalidateAssetData } from '@/lib/queries';
import { EXIT_CASE_TONE, EXIT_ITEM_TONE } from '@/lib/status';
import type { ExitCaseDetail, ExitItem, HistoryEvent } from '@/lib/types';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { DaysLeft } from './exits-page';

const ITEM_BUTTON: Record<ExitItemStatus, string> = {
  PENDING: 'data-[on=true]:bg-amber-100 data-[on=true]:text-amber-800 dark:data-[on=true]:bg-amber-950 dark:data-[on=true]:text-amber-300',
  RETURNED: 'data-[on=true]:bg-emerald-100 data-[on=true]:text-emerald-800 dark:data-[on=true]:bg-emerald-950 dark:data-[on=true]:text-emerald-300',
  DAMAGED: 'data-[on=true]:bg-orange-100 data-[on=true]:text-orange-800 dark:data-[on=true]:bg-orange-950 dark:data-[on=true]:text-orange-300',
  MISSING: 'data-[on=true]:bg-red-100 data-[on=true]:text-red-800 dark:data-[on=true]:bg-red-950 dark:data-[on=true]:text-red-300',
};

export default function ExitDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [scan, setScan] = useState('');
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['exit', id], queryFn: () => api.get<ExitCaseDetail>(`/exit-cases/${id}`), placeholderData: undefined });
  const history = useQuery({ queryKey: ['history', 'exit', id], queryFn: () => api.get<Page<HistoryEvent>>(`/exit-cases/${id}/history`), enabled: !!q.data });

  const refresh = () => invalidateAssetData();
  const updateItem = useMutation({
    mutationFn: ({ item, status }: { item: ExitItem; status: ExitItemStatus }) => api.patch(`/exit-cases/${id}/items/${item.id}`, { status }),
    onSuccess: async (_d, v) => {
      await refresh();
      toast.success(`${v.item.assetTag ?? v.item.assetName}: ${humanize(v.status).toLowerCase()}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const scanMut = useMutation({
    mutationFn: (code: string) => api.post<{ item: ExitItem; alreadyCleared: boolean }>(`/exit-cases/${id}/scan`, { code }),
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
  const complete = useMutation({
    mutationFn: () => api.post(`/exit-cases/${id}/complete`),
    onSuccess: async () => {
      await refresh();
      toast.success('Exit completed — all assets cleared');
    },
    onError: (err) => toast.error(errorMessage(err), { duration: 8000 }),
  });
  const override = useMutation({
    mutationFn: (reason: string) => api.post(`/exit-cases/${id}/override`, { reason }),
    onSuccess: async () => {
      await refresh();
      toast.success('Exit completed with authorised override');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/exit-cases/${id}/cancel`, { reason }),
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
    if (manage) scanMut.mutate(code);
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
    if (r.confirmed) override.mutate(r.note);
  };

  const askCancel = async () => {
    const r = await confirm({
      title: 'Withdraw notice?',
      description: `${x.employee.fullName} goes back to Active and this checklist is cancelled. Assets stay with them.`,
      confirmText: 'Withdraw notice',
      note: { label: 'Reason', placeholder: 'Resignation withdrawn…' },
    });
    if (r.confirmed) cancel.mutate(r.note);
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/exits" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Exits
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={x.employee.fullName} className="size-14 text-base" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Exit clearance · {x.caseNumber}</p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                <Link to={`/employees/${x.employee.id}`} className="hover:text-primary">
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
          <Card className="flex items-center gap-4 px-4 py-3">
            <div>
              <p className="text-xs text-muted-foreground">Last working day</p>
              <p className="text-lg font-semibold">{formatDate(x.lastWorkingDate)}</p>
            </div>
            {open && <DaysLeft date={x.lastWorkingDate} className="text-sm" />}
          </Card>
        </div>
      </div>

      {x.status === 'COMPLETED' && (
        <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', x.overridden ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200' : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200')}>
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4 sm:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[13px] font-medium text-muted-foreground">Recovery progress</p>
              <p className="mt-1 text-2xl font-semibold tabular">
                {x.counts.cleared} <span className="text-base font-normal text-muted-foreground">of {x.counts.total} cleared</span>
              </p>
            </div>
            <span className="text-2xl font-semibold tabular text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="mt-3 h-2" indicatorClassName={blocking ? 'bg-amber-500' : 'bg-emerald-500'} />
        </Card>
        {(['RETURNED', 'DAMAGED', 'PENDING', 'MISSING'] as const).map((s) => (
          <Card key={s} className={cn('p-4', s === 'RETURNED' && 'hidden lg:block')}>
            <p className="text-[13px] font-medium text-muted-foreground">{humanize(s)}</p>
            <p className={cn('mt-1 text-2xl font-semibold tabular', s === 'MISSING' && x.counts.missing && 'text-red-600', s === 'PENDING' && x.counts.pending && 'text-amber-600')}>
              {x.counts[s.toLowerCase() as 'returned']}
            </p>
          </Card>
        ))}
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
                    if (scan.trim()) scanMut.mutate(scan.trim());
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
                {camera && <CameraScanner className="mt-3" onCode={(c) => scanMut.mutate(c)} />}
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
                          <Link to={`/assets/${item.assetId}`} className="truncate font-medium hover:text-primary">
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
                              onClick={() => updateItem.mutate({ item, status: s })}
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
                    <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      <Lock className="mt-0.5 size-4 shrink-0" />
                      <p>
                        Blocked: <span className="font-semibold">{x.counts.pending}</span> pending and <span className="font-semibold">{x.counts.missing}</span> missing. Recover them, or record an authorised override.
                      </p>
                    </div>
                  ) : (
                    <div className="flex gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                      <p>All assets are cleared. You can complete the exit.</p>
                    </div>
                  )}
                  {can('exit:manage') && (
                    <Button
                      className="w-full"
                      variant={blocking ? 'outline' : 'success'}
                      loading={complete.isPending}
                      onClick={() => complete.mutate()}
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
  const add = useMutation({
    mutationFn: () => api.post(`/exit-cases/${caseId}/items`, { assetName: name, notes }),
    onSuccess: async () => {
      await invalidateAssetData();
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
          <Button disabled={!name.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
