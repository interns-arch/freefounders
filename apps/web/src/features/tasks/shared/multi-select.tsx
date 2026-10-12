import { ChevronDown, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface MultiSelectOption {
  id: number;
  name: string;
  department_name?: string;
}

/**
 * A searchable multi-picker (people for "Assign to", "Loop", group members…). The search matches the name and the
 * department. Each option is a labelled checkbox, so tests and screen readers find people by name.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = '— select —',
  id,
  label,
  className,
}: {
  options: MultiSelectOption[];
  selected: number[];
  onChange: (next: number[]) => void;
  placeholder?: string;
  /** id of the trigger button (for a <Label htmlFor>). */
  id?: string;
  /** Accessible name when there is no visible label. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const auto = useId();
  const picked = options.filter((o) => selected.includes(o.id));
  const text = picked.length === 0 ? placeholder : picked.length <= 2 ? picked.map((o) => o.name).join(', ') : `${picked.length} selected`;
  const term = q.trim().toLowerCase();
  const shown = term ? options.filter((o) => `${o.name} ${o.department_name ?? ''}`.toLowerCase().includes(term)) : options;
  const toggle = (oid: number) => onChange(selected.includes(oid) ? selected.filter((x) => x !== oid) : [...selected, oid]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={label}
          className={cn(
            'flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none max-sm:h-11 max-sm:text-base focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
            !picked.length && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{text}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search name or department" placeholder="Search name or department…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" autoFocus />
        </div>
        <div className="max-h-56 overflow-y-auto scrollbar-thin" role="group" aria-label={label ?? 'Options'}>
          {shown.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No one matches “{q}”.</p>}
          {shown.map((o) => {
            const cid = `${auto}-${o.id}`;
            return (
              <label key={o.id} htmlFor={cid} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox id={cid} checked={selected.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
                <span className="min-w-0 truncate">
                  {o.name}
                  {o.department_name && <span className="text-xs text-muted-foreground"> ({o.department_name})</span>}
                </span>
              </label>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
            <span>{selected.length} selected</span>
            <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
