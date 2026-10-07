import { ASSIGNABLE_HOLDERS, HOLDER_TYPE_LABELS, type HolderType } from '@eam/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { toast } from 'sonner';
import { api, errorMessage, type Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { queryClient, useCompanies, useDepartments, useLocations, useVendors } from '@/lib/queries';
import type { AssetListItem, Employee } from '@/lib/types';
import { useDebounced } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { HOLDER_ICONS } from './badges';

export interface Option {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface ComboboxProps {
  value: string | null | undefined;
  onChange: (value: string | null, option?: Option) => void;
  options: Option[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  /** When set, filtering is done by the caller (server search). */
  onSearch?: (text: string) => void;
  selectedLabel?: string | null;
  disabled?: boolean;
  clearable?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  /**
   * Adds an "Add …" item so people can enter something that isn't in the list yet.
   * Receives the typed text; return an option to select it straight away.
   */
  onCreate?: (text: string) => Promise<Option | void> | Option | void;
  /** Label for the add item, e.g. (t) => `Add company “${t}”`. */
  createLabel?: (text: string) => string;
  /** When false, the add item only appears once something is typed. */
  createWithoutText?: boolean;
}

/** Searchable select built on cmdk: type to filter, arrows + Enter to pick, optionally add new. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches',
  loading,
  onSearch,
  selectedLabel,
  disabled,
  clearable = true,
  invalid,
  className,
  id,
  onCreate,
  createLabel,
  createWithoutText = true,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const typed = text.trim();
  const exact = options.some((o) => o.label.toLowerCase() === typed.toLowerCase());
  const showCreate = !!onCreate && (typed ? !exact : createWithoutText);
  const create = async () => {
    if (!onCreate || creating) return;
    setCreating(true);
    try {
      const o = await onCreate(typed);
      if (o) onChange(o.value, o);
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };
  const current = options.find((o) => o.value === value);
  const label = current?.label ?? (value ? selectedLabel : null);

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
            className,
          )}
        >
          {current?.icon}
          <span className={cn('flex-1 truncate', !label && 'text-muted-foreground/70')}>{label ?? placeholder}</span>
          {clearable && value && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <Command shouldFilter={!onSearch}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={text}
            onValueChange={(v) => {
              setText(v);
              onSearch?.(v);
            }}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </div>
            ) : (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.description ?? ''} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value, o);
                    setOpen(false);
                  }}
                >
                  {o.icon}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{o.label}</div>
                    {o.description && <div className="truncate text-xs text-muted-foreground">{o.description}</div>}
                  </div>
                  {o.value === value && <Check className="size-4 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
            {showCreate && (
              <CommandGroup className="border-t">
                <CommandItem forceMount value={`__create__ ${typed}`} onSelect={() => void create()} disabled={creating} className="text-primary data-[selected=true]:text-primary">
                  {creating ? <Loader2 className="animate-spin" /> : <Plus />}
                  <span className="truncate font-medium">{createLabel ? createLabel(typed) : typed ? `Add “${typed}”` : 'Add new…'}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface EntityPickerProps extends Omit<ComboboxProps, 'options' | 'onSearch' | 'loading'> {
  kind: HolderType | 'asset' | 'store';
  /** Extra filters for asset search, e.g. { status: 'AVAILABLE', assetTypeId }. */
  assetFilter?: Record<string, string | undefined>;
  employeeFilter?: Record<string, string | undefined>;
  /** For assets / employees: open a form to add a new one (receives the typed text). */
  onAddNew?: (text: string) => void;
}

const QUICK_CREATE: Partial<Record<EntityPickerProps['kind'], { path: string; noun: string; body?: Record<string, unknown> }>> = {
  COMPANY: { path: 'companies', noun: 'company' },
  DEPARTMENT: { path: 'departments', noun: 'department' },
  LOCATION: { path: 'locations', noun: 'location' },
  INVENTORY: { path: 'locations', noun: 'store', body: { isStore: true, type: 'WAREHOUSE' } },
  store: { path: 'locations', noun: 'store', body: { isStore: true, type: 'WAREHOUSE' } },
  VENDOR: { path: 'vendors', noun: 'vendor' },
};

/** Picks an employee / department / location / company / vendor / store / asset by name. */
export function EntityPicker({ kind, assetFilter, employeeFilter, placeholder, onAddNew, ...props }: EntityPickerProps) {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 200);
  const [chosen, setChosen] = useState<string | null>(null);
  const companies = useCompanies();
  const departments = useDepartments();
  const locations = useLocations();
  const vendors = useVendors();

  const employees = useQuery({
    queryKey: ['picker', 'employees', q, employeeFilter],
    queryFn: () => api.get<Page<Employee>>('/employees', { search: q, pageSize: 20, ...employeeFilter }),
    enabled: kind === 'EMPLOYEE',
  });
  const assets = useQuery({
    queryKey: ['picker', 'assets', q, assetFilter],
    queryFn: () => api.get<Page<AssetListItem>>('/assets', { search: q, pageSize: 20, sort: 'assetTag', dir: 'asc', ...assetFilter }),
    enabled: kind === 'asset',
  });

  const options: Option[] = useMemo(() => {
    const iconOf = (t: HolderType) => {
      const I = HOLDER_ICONS[t];
      return <I className="size-4 text-muted-foreground" />;
    };
    switch (kind) {
      case 'EMPLOYEE':
        return (employees.data?.items ?? []).map((e) => ({
          value: e.id,
          label: `${e.fullName}`,
          description: [e.employeeCode, e.designation, e.departmentName, e.status === 'NOTICE_PERIOD' ? 'On notice' : null].filter(Boolean).join(' · '),
          icon: iconOf('EMPLOYEE'),
        }));
      case 'asset':
        return (assets.data?.items ?? []).map((a) => ({
          value: a.id,
          label: a.name,
          description: [a.assetTag, a.typeName, a.trackingMode === 'QUANTITY' ? `${a.availableQuantity} free` : a.holderName].filter(Boolean).join(' · '),
          icon: <AssetIcon icon={a.typeIcon ?? a.categoryIcon} color={a.categoryColor} size="sm" />,
        }));
      case 'DEPARTMENT':
        return (departments.data ?? []).map((d) => ({ value: d.id, label: d.name, description: d.code ?? undefined, icon: iconOf('DEPARTMENT') }));
      case 'COMPANY':
        return (companies.data ?? []).map((d) => ({ value: d.id, label: d.name, description: d.code ?? undefined, icon: iconOf('COMPANY') }));
      case 'VENDOR':
        return (vendors.data ?? []).map((d) => ({ value: d.id, label: d.name, icon: iconOf('VENDOR') }));
      case 'INVENTORY':
      case 'store':
        return [...(locations.data ?? [])]
          .sort((a, b) => Number(b.isStore) - Number(a.isStore))
          .map((l) => ({ value: l.id, label: l.name, description: l.isStore ? 'Store / warehouse' : l.type.toLowerCase(), icon: iconOf('INVENTORY') }));
      case 'LOCATION':
        return (locations.data ?? []).map((l) => ({ value: l.id, label: l.name, description: [l.code, l.isStore ? 'Store' : null].filter(Boolean).join(' · '), icon: iconOf('LOCATION') }));
    }
  }, [kind, employees.data, assets.data, departments.data, companies.data, vendors.data, locations.data]);

  const remote = kind === 'EMPLOYEE' || kind === 'asset';
  const quick = QUICK_CREATE[kind];
  // Type a name that isn't in the list and add it on the spot (company, department, location, vendor, store).
  const quickCreate =
    quick && can('org:manage')
      ? async (name: string): Promise<Option | void> => {
          if (!name) return void toast.info(`Type the new ${quick.noun}’s name first`);
          const row = await api.post<{ id: string; name: string }>(`/${quick.path}`, { name, ...quick.body });
          await queryClient.invalidateQueries({ queryKey: ['lookup'] });
          toast.success(`Added ${quick.noun} “${row.name}”`);
          return { value: row.id, label: row.name };
        }
      : undefined;
  const addNew = onAddNew
    ? (text: string) => {
        onAddNew(text);
      }
    : undefined;
  return (
    <Combobox
      {...props}
      onCreate={quickCreate ?? addNew}
      createWithoutText={!quickCreate}
      createLabel={(t) =>
        quick ? `Add ${quick.noun} “${t}”` : kind === 'asset' ? (t ? `Add new asset “${t}”` : 'Add a new asset') : t ? `Add “${t}”` : 'Add new'
      }
      options={options}
      loading={remote ? (kind === 'EMPLOYEE' ? employees.isFetching : assets.isFetching) && options.length === 0 : false}
      onSearch={remote ? setSearch : undefined}
      selectedLabel={props.selectedLabel ?? chosen}
      placeholder={placeholder ?? (kind === 'asset' ? 'Search assets by name, tag or serial…' : kind === 'EMPLOYEE' ? 'Search employees…' : 'Select…')}
      searchPlaceholder={kind === 'asset' ? 'Name, tag, serial…' : 'Search…'}
      onChange={(v, o) => {
        setChosen(o?.label ?? null);
        props.onChange(v, o);
      }}
    />
  );
}

/** Holder type tabs + the matching picker. */
export function HolderPicker({
  holderType,
  holderId,
  onChange,
  allowed = ASSIGNABLE_HOLDERS,
  invalid,
  selectedLabel,
}: {
  holderType: HolderType;
  holderId: string | null;
  onChange: (holderType: HolderType, holderId: string | null) => void;
  allowed?: readonly HolderType[];
  invalid?: boolean;
  selectedLabel?: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {allowed.map((t) => {
          const I = HOLDER_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(t, null)}
              className={cn(
                'inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground',
                holderType === t && 'bg-card text-foreground shadow-sm',
              )}
            >
              <I className="size-3.5" />
              {t === 'INVENTORY' ? 'In store' : HOLDER_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
      {holderType === 'INVENTORY' ? (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">It goes back to the company store — not with anyone.</p>
      ) : (
      <EntityPicker
        key={holderType}
        kind={holderType}
        value={holderId}
        invalid={invalid}
        selectedLabel={selectedLabel}
        onChange={(v) => onChange(holderType, v)}
        employeeFilter={{ status: 'ACTIVE,ON_LEAVE,NOTICE_PERIOD' }}
        placeholder={`Choose ${HOLDER_TYPE_LABELS[holderType].toLowerCase()}…`}
      />
      )}
    </div>
  );
}
