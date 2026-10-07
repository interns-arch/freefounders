import { EMPLOYEE_STATUS_LABELS, type EmployeeStatus } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { api, errorMessage } from '@/lib/api';
import { invalidateAssetData } from '@/lib/queries';
import type { EmployeeDetail } from '@/lib/types';
import { cn, todayISO } from '@/lib/utils';

const OPTIONS: { value: EmployeeStatus; label: string; text: string }[] = [
  { value: 'ACTIVE', label: 'Active', text: 'Working normally' },
  { value: 'ON_LEAVE', label: 'On leave', text: 'Temporarily away' },
  { value: 'NOTICE_PERIOD', label: 'Notice period / leaving', text: 'Starts asset recovery' },
];

/** HR status change. Notice Period builds the exit checklist of every asset the person holds. */
export function StatusDialog({ employee, open, onOpenChange }: { employee: EmployeeDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<EmployeeStatus>(employee.status === 'ACTIVE' ? 'NOTICE_PERIOD' : employee.status === 'EXITED' ? 'ACTIVE' : employee.status);
  const [lwd, setLwd] = useState(employee.lastWorkingDate ?? todayISO(30));
  const [noticeDate, setNoticeDate] = useState(employee.noticeDate ?? todayISO());
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.post<{ ok: boolean; exitCaseId?: string }>(`/employees/${employee.id}/status`, { status, lastWorkingDate: status === 'NOTICE_PERIOD' ? lwd : null, noticeDate: status === 'NOTICE_PERIOD' ? noticeDate : null, reason }),
    onSuccess: async (r) => {
      await invalidateAssetData();
      onOpenChange(false);
      if (status === 'NOTICE_PERIOD' && r.exitCaseId) {
        toast.success(`${employee.fullName} is on notice`, {
          description: `${employee.assets.length} asset(s) added to the recovery checklist. IT/Admin have been notified.`,
        });
        navigate(`/exits/${r.exitCaseId}`);
      } else toast.success(`Status changed to ${EMPLOYEE_STATUS_LABELS[status]}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const withdrawing = employee.status === 'NOTICE_PERIOD' && status !== 'NOTICE_PERIOD';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            {employee.fullName} is currently <span className="font-medium text-foreground">{EMPLOYEE_STATUS_LABELS[employee.status]}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setStatus(o.value)}
                className={cn(
                  'flex cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition hover:border-primary/40',
                  status === o.value && 'border-primary bg-primary/5 ring-1 ring-primary/30',
                )}
              >
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.text}</span>
                </span>
                {o.value === 'NOTICE_PERIOD' && <LogOut className="size-4 text-amber-600" />}
              </button>
            ))}
          </div>
          {status === 'NOTICE_PERIOD' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Notice given on">
                  <Input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
                </Field>
                <Field label="Last working day" required>
                  <Input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} />
                </Field>
              </div>
              <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  {employee.assets.length > 0 ? (
                    <>
                      All <span className="font-semibold">{employee.assets.length}</span> asset(s) they hold go on a recovery checklist, and IT/Admin are notified. The exit can’t be completed until they’re returned or an authorised override is recorded.
                    </>
                  ) : (
                    'They hold no assets, so the exit can be completed right away.'
                  )}
                </p>
              </div>
            </>
          )}
          {withdrawing && <p className="text-sm text-muted-foreground">This withdraws the notice and cancels the open exit checklist.</p>}
          <Field label="Reason / notes">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={status === 'NOTICE_PERIOD' ? 'Resigned, contract end…' : undefined} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={status === employee.status && status !== 'NOTICE_PERIOD'} onClick={() => save.mutate()}>
            {status === 'NOTICE_PERIOD' && employee.status !== 'NOTICE_PERIOD' ? 'Start notice & build checklist' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
