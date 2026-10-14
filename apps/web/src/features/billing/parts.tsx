/** Small pieces shared by the billing screens. */
import type { SubscriptionState } from '@freefounders/core';
import { STATE_LABELS } from '@freefounders/core/billing';
import { Minus, Plus } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type BadgeTone } from '@/components/ui/primitives';

const STATE_TONE: Record<SubscriptionState, BadgeTone> = {
  trialing: 'blue',
  active: 'green',
  past_due: 'amber',
  read_only: 'red',
  suspended: 'red',
  cancelled: 'neutral',
};

export function StateBadge({ state }: { state: SubscriptionState }) {
  return <Badge tone={STATE_TONE[state] ?? 'neutral'}>{STATE_LABELS[state] ?? state}</Badge>;
}

/** − [n] + with a typed value too; never below `min` or above `max`. */
export function SeatStepper({ id, value, onChange, min, max, label = 'Users' }: { id: string; value: number; onChange: (n: number) => void; min: number; max?: number | null; label?: string }) {
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <Button type="button" variant="outline" size="icon" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
        <Minus />
      </Button>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="w-20 text-center font-mono tabular-nums"
        min={min}
        max={max ?? undefined}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        onBlur={() => onChange(clamp(value))}
        aria-label={label}
      />
      <Button type="button" variant="outline" size="icon" onClick={() => onChange(clamp(value + 1))} disabled={max != null && value >= max} aria-label={`More ${label.toLowerCase()}`}>
        <Plus />
      </Button>
    </div>
  );
}
