import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { api } from '@/lib/api';
import type { FieldDefinition } from '@/lib/types';

/** Filters on custom fields (RAM ≥ 16, Fuel type = Diesel…) for the chosen category / type. */
export function AttributeFilters({
  categoryId,
  assetTypeId,
  values,
  onApply,
}: {
  categoryId?: string;
  assetTypeId?: string;
  values: Record<string, string>;
  onApply: (patch: Record<string, string | null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const enabled = !!(categoryId || assetTypeId);
  const fields = useQuery({
    queryKey: ['filterable-fields', categoryId, assetTypeId],
    queryFn: () => api.get<FieldDefinition[]>('/fields/filterable', { categoryId, assetTypeId }),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: undefined,
  });
  // De-duplicate keys shared by sibling types (e.g. "processor" on Laptop and Desktop).
  const defs = [...new Map((fields.data ?? []).map((f) => [f.key, f])).values()];
  const current = Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith('f.')));
  const [draft, setDraft] = useState<Record<string, string>>(current);
  useEffect(() => {
    if (open) setDraft(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const active = Object.keys(current).length;

  if (!enabled) return null;
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <SlidersHorizontal /> Specs {active > 0 && <span className="rounded bg-primary px-1.5 text-[11px] text-primary-foreground">{active}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3 scrollbar-thin">
          {!defs.length && <p className="py-4 text-center text-sm text-muted-foreground">{fields.isLoading ? 'Loading…' : 'No filterable fields'}</p>}
          {defs.map((f) => {
            const k = `f.${f.key}`;
            return (
              <div key={f.key} className="grid gap-1.5">
                <Label>{f.label}</Label>
                {f.type === 'select' || f.type === 'multiselect' ? (
                  <NativeSelect className="h-8 text-[13px]" value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
                    <option value="">Any</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </NativeSelect>
                ) : f.type === 'boolean' ? (
                  <NativeSelect className="h-8 text-[13px]" value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
                    <option value="">Any</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </NativeSelect>
                ) : f.type === 'number' || f.type === 'currency' || f.type === 'date' ? (
                  <div className="flex items-center gap-2">
                    <Input className="h-8 text-[13px]" type={f.type === 'date' ? 'date' : 'number'} placeholder="From" value={draft[`${k}.min`] ?? ''} onChange={(e) => set(`${k}.min`, e.target.value)} />
                    <span className="text-muted-foreground">–</span>
                    <Input className="h-8 text-[13px]" type={f.type === 'date' ? 'date' : 'number'} placeholder="To" value={draft[`${k}.max`] ?? ''} onChange={(e) => set(`${k}.max`, e.target.value)} />
                  </div>
                ) : (
                  <Input className="h-8 text-[13px]" placeholder="Contains…" value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between gap-2 border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onApply(Object.fromEntries(Object.keys(current).map((k) => [k, null])));
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const patch: Record<string, string | null> = Object.fromEntries(Object.keys(current).map((k) => [k, null]));
              for (const [k, v] of Object.entries(draft)) patch[k] = v || null;
              onApply(patch);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
