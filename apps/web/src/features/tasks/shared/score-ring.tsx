import { cn } from '@/lib/utils';

/** The on-time score drawn the same way everywhere: a ring readable at a glance. null = nothing scored yet. */
export function ScoreRing({ value, size = 34, className }: { value: number | null | undefined; size?: number; className?: string }) {
  const scored = value !== null && value !== undefined;
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const colour = !scored ? 'var(--border)' : pct >= 75 ? 'var(--success)' : pct >= 45 ? 'var(--warning)' : 'var(--destructive)';
  const label = scored ? `${Math.round(pct)}% on time` : 'Nothing scored yet';
  return (
    <span
      role="img"
      aria-label={`Score: ${label}`}
      title={label}
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, background: `conic-gradient(${colour} ${pct * 3.6}deg, var(--muted) 0)` }}
    >
      <span
        className="flex items-center justify-center rounded-full bg-card text-xs font-semibold tabular"
        style={{ width: size - 8, height: size - 8 }}
      >
        {scored ? Math.round(pct) : '—'}
      </span>
    </span>
  );
}
