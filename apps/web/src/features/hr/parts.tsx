/** HR building blocks: status chips, punch photo thumbnails, formatting. */
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus, usePunchPhoto } from '@freefounders/core/hr';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Chip, type Tone } from '../tasks/general/parts';

export const STATUS_TONE: Record<AttendanceStatus, Tone> = {
  present: 'success',
  late: 'warning',
  half_day: 'warning',
  absent: 'danger',
  leave: 'info',
  holiday: 'primary',
  week_off: 'neutral',
  not_checked_in: 'neutral',
};

/** Background for a calendar day (theme colours only). */
export const STATUS_CELL: Record<string, string> = {
  present: 'bg-success/15 border-success/30',
  late: 'bg-warning/18 border-warning/40',
  half_day: 'bg-warning/10 border-warning/30',
  absent: 'bg-destructive/12 border-destructive/30',
  leave: 'bg-info/12 border-info/30',
  holiday: 'bg-primary/10 border-primary/25',
  week_off: 'bg-muted border-border',
  future: 'bg-card border-border',
};

export function AttendanceChip({ status, extra }: { status: AttendanceStatus; extra?: string }) {
  return (
    <Chip tone={STATUS_TONE[status] ?? 'neutral'}>
      {ATTENDANCE_STATUS_LABELS[status] ?? status}
      {extra}
    </Chip>
  );
}

/** "7h 30m" from minutes, or "—". */
export const hrs = (m: number | null | undefined) => (m ? `${Math.floor(m / 60)}h ${m % 60}m` : '—');

/** A punch photo: a small thumbnail (named e.g. "Asha check-in photo") that opens large. Loaded with the sign-in token. */
export function PunchPhoto({ id, which, label }: { id: number | null | undefined; which: 'in' | 'out'; label: string }) {
  const q = usePunchPhoto(id, which);
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  if (!url) return null;
  return (
    <>
      <button type="button" aria-label={label} onClick={() => setOpen(true)} className="ml-1.5 inline-block size-8 cursor-pointer overflow-hidden rounded-md border align-middle hover:ring-2 hover:ring-primary/40">
        <img src={url} alt="" className="size-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <img src={url} alt={label} className="w-full rounded-lg" />
        </DialogContent>
      </Dialog>
    </>
  );
}
