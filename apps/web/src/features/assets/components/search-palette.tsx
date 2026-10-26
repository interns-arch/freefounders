import { ArrowRight, Loader2, Plus, ScanLine } from '@/components/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AssetStatusBadge, EmployeeStatusBadge } from '@/components/common/badges';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Dialog, DialogContent } from '@/components/ui/overlays';
import { DialogTitle } from '@/components/ui/overlays';
import { Kbd } from '@/components/ui/input';
import { useQuickAdd, useQuickAddItems } from '@/features/assets/quick-add/quick-add';
import { useAccess } from '@kaampilot/core';
import { useAssetsSearch } from '@kaampilot/core/assets';
import { AssetIcon } from '@/lib/icons';
import { useDebounced } from '@/lib/url-state';
import { Avatar } from '@/components/ui/primitives';
import { ASSETS_NAV } from '@/features/assets/nav';

/** Ctrl/⌘+K: search everything, jump anywhere, run any "+ Add" action. */
export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 150);
  const navigate = useNavigate();
  const quickAdd = useQuickAdd();

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  const results = useAssetsSearch(q, open && q.length >= 2);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const r = q.length >= 2 ? results.data : undefined;
  const access = useAccess();
  const nav = ASSETS_NAV.filter((n) => !n.show || n.show(access));
  const adds = useQuickAddItems();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0 max-sm:top-2 max-sm:bottom-auto max-sm:rounded-xl max-sm:border max-sm:p-0 max-sm:w-[calc(100%-1rem)] max-sm:pb-0" hideClose>
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <Command shouldFilter={!r} loop>
          <CommandInput
            placeholder="Search assets, people, tags, serials… or type a command"
            value={text}
            onValueChange={setText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && r?.exact) {
                e.preventDefault();
                go(`/assets/assets/${r.exact.id}`);
              }
            }}
          />
          <CommandList>
            {results.isFetching && q.length >= 2 && !r && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </div>
            )}
            <CommandEmpty>No results for “{text}”</CommandEmpty>

            {r?.exact && (
              <CommandGroup heading="Exact match">
                <CommandItem value={`exact ${r.exact.assetTag}`} onSelect={() => go(`/assets/assets/${r.exact!.id}`)}>
                  <ScanLine className="text-primary" />
                  <span className="font-mono text-xs">{r.exact.assetTag}</span>
                  <span className="truncate">{r.exact.name}</span>
                  <span className="ml-auto">
                    <AssetStatusBadge status={r.exact.status} />
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {!!r?.assets.length && (
              <CommandGroup heading="Assets">
                {r.assets.map((a) => (
                  <CommandItem key={a.id} value={`asset ${a.id} ${a.assetTag} ${a.name}`} onSelect={() => go(`/assets/assets/${a.id}`)}>
                    <AssetIcon icon={a.typeIcon ?? a.categoryIcon} color={a.categoryColor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{a.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {a.assetTag} · {a.typeName}
                        {a.holderName ? ` · ${a.holderName}` : ''}
                      </div>
                    </div>
                    <AssetStatusBadge status={a.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!r?.employees.length && (
              <CommandGroup heading="Employees">
                {r.employees.map((e) => (
                  <CommandItem key={e.id} value={`emp ${e.id} ${e.fullName}`} onSelect={() => go(`/assets/employees/${e.id}`)}>
                    <Avatar name={e.fullName} className="size-6" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{e.fullName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {e.employeeCode} · {e.designation ?? '—'} · {e.assetCount} assets
                      </div>
                    </div>
                    <EmployeeStatusBadge status={e.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!r?.assetTypes.length && (
              <CommandGroup heading="Asset types">
                {r.assetTypes.map((t) => (
                  <CommandItem key={t.id} value={`type ${t.id} ${t.name}`} onSelect={() => go(`/assets/assets?assetTypeId=${t.id}`)}>
                    <AssetIcon icon={t.icon} color={null} size="sm" />
                    <span>{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.categoryName}</span>
                    <ArrowRight className="ml-auto text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!(r?.departments.length || r?.vendors.length) && (
              <CommandGroup heading="Organisation">
                {r!.departments.map((d) => (
                  <CommandItem key={d.id} value={`dept ${d.id} ${d.name}`} onSelect={() => go(`/assets/assets?holderType=DEPARTMENT&holderId=${d.id}`)}>
                    <span className="text-muted-foreground">Department</span> {d.name}
                  </CommandItem>
                ))}
                {r!.vendors.map((v) => (
                  <CommandItem key={v.id} value={`vendor ${v.id} ${v.name}`} onSelect={() => go(`/assets/assets?vendorId=${v.id}`)}>
                    <span className="text-muted-foreground">Vendor</span> {v.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!r && (
              <>
                <CommandGroup heading="Quick add">
                  {adds.map((a) => (
                    <CommandItem
                      key={a.kind}
                      value={`add new ${a.label}`}
                      onSelect={() => {
                        onOpenChange(false);
                        quickAdd.open(a.kind);
                      }}
                    >
                      <Plus className="text-muted-foreground" />
                      Add {a.label.toLowerCase()}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup heading="Go to">
                  {nav.map((n) => (
                    <CommandItem key={n.to} value={`go ${n.label}`} onSelect={() => go(n.to)}>
                      <n.icon className="text-muted-foreground" />
                      {n.label}
                      
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> open
            </span>
            <span className="ml-auto">Tip: type or scan an asset tag / serial to jump straight to it</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
