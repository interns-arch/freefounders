import type { ReconStatus } from '@eam/shared';
import { Badge, type BadgeTone } from '@/components/ui/primitives';

export const STATUS_META: Record<ReconStatus, { label: string; tone: BadgeTone }> = {
  MATCHED: { label: 'Matched', tone: 'green' },
  MISMATCH: { label: 'Mismatch', tone: 'red' },
  MISSING_IN_SYSTEM: { label: 'Not in system', tone: 'amber' },
  MISSING_IN_DUMP: { label: 'Not in file', tone: 'gray' },
  INVALID: { label: 'Invalid row', tone: 'orange' },
};

export function SummaryChips({ summary }: { summary: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(STATUS_META) as ReconStatus[])
        .filter((s) => summary[s])
        .map((s) => (
          <Badge key={s} tone={STATUS_META[s].tone}>
            {summary[s]} {STATUS_META[s].label.toLowerCase()}
          </Badge>
        ))}
    </div>
  );
}
