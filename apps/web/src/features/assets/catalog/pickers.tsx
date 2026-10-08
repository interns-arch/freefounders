import { COLOR_NAMES, COLORS, DynamicIcon, ICON_NAMES } from '@/lib/icons';
import { cn } from '@/lib/utils';

export function IconPicker({ value, onChange, color }: { value: string | null; onChange: (v: string) => void; color?: string | null }) {
  const c = COLORS[color ?? ''] ?? COLORS.indigo;
  return (
    <div className="grid max-h-40 grid-cols-10 gap-1 overflow-y-auto rounded-lg border p-1.5 scrollbar-thin">
      {ICON_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          title={name}
          onClick={() => onChange(name)}
          className={cn(
            'flex aspect-square cursor-pointer items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground [&_svg]:size-4',
            value === name && cn(c.bg, c.text, 'ring-2 ring-primary/40'),
          )}
        >
          <DynamicIcon name={name} />
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          title={name}
          onClick={() => onChange(name)}
          className={cn('size-7 cursor-pointer rounded-full ring-offset-2 ring-offset-background transition', COLORS[name].bar, value === name && 'ring-2 ring-foreground/60')}
        />
      ))}
    </div>
  );
}
