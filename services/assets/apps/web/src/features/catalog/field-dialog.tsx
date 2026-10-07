import { FIELD_TYPE_LABELS, FIELD_TYPES, type FieldType, NUMERIC_FIELD_TYPES, OPTION_FIELD_TYPES, slugifyKey } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Switch } from '@/components/ui/primitives';
import { api, ApiError, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { FieldDefinition } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  owner: { categoryId?: string; assetTypeId?: string; name: string };
  field?: FieldDefinition | null;
}

/** Create or edit one custom field. Key and data type are fixed once created (data depends on them). */
export function FieldDialog({ open, onOpenChange, owner, field }: Props) {
  const editing = !!field;
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>('text');
  const [required, setRequired] = useState(false);
  const [isUnique, setUnique] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [optionText, setOptionText] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [helpText, setHelpText] = useState('');
  const [showInTable, setShowInTable] = useState(false);
  const [filterable, setFilterable] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setLabel(field?.label ?? '');
    setKey(field?.key ?? '');
    setKeyTouched(!!field);
    setType(field?.type ?? 'text');
    setRequired(field?.required ?? false);
    setUnique(field?.isUnique ?? false);
    setOptions(field?.options ?? []);
    setOptionText('');
    setMin(field?.min?.toString() ?? '');
    setMax(field?.max?.toString() ?? '');
    setPlaceholder(field?.placeholder ?? '');
    setHelpText(field?.helpText ?? '');
    setShowInTable(field?.showInTable ?? false);
    setFilterable(field?.filterable ?? true);
    setErrors({});
  }, [open, field]);

  const hasOptions = OPTION_FIELD_TYPES.includes(type);
  const numeric = NUMERIC_FIELD_TYPES.includes(type);
  const textual = type === 'text' || type === 'textarea';

  const save = useMutation({
    mutationFn: () => {
      const common = {
        label,
        required,
        isUnique,
        options: hasOptions ? options : null,
        min: numeric || textual ? (min === '' ? null : Number(min)) : null,
        max: numeric || textual ? (max === '' ? null : Number(max)) : null,
        placeholder,
        helpText,
        showInTable,
        filterable,
      };
      return editing
        ? api.patch(`/fields/${field!.id}`, common)
        : api.post('/fields', { ...common, key: key || undefined, type, categoryId: owner.categoryId ?? null, assetTypeId: owner.assetTypeId ?? null });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fields'] }),
        queryClient.invalidateQueries({ queryKey: ['asset-type'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
        queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
        queryClient.invalidateQueries({ queryKey: ['filterable-fields'] }),
      ]);
      toast.success(editing ? 'Field updated' : `Field "${label}" added to ${owner.name}`);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.errors) setErrors(err.errors);
      toast.error(errorMessage(err));
    },
  });

  const addOption = () => {
    const parts = optionText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setOptions((o) => [...new Set([...o, ...parts])]);
    setOptionText('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit field “${field!.label}”` : 'Add field'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Existing values are kept.' : `Adds a field to every ${owner.name} asset — no code changes.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label" required error={errors.label} className="col-span-2 sm:col-span-1">
              <Input
                autoFocus
                value={label}
                placeholder="Engine No."
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (!keyTouched) setKey(slugifyKey(e.target.value));
                }}
              />
            </Field>
            <Field label="Type" className="col-span-2 sm:col-span-1" hint={editing ? 'Fixed after creation' : undefined}>
              <NativeSelect value={type} disabled={editing} onChange={(e) => setType(e.target.value as FieldType)}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Key" hint={editing ? 'Fixed after creation' : 'Used in filters and the API'} error={errors.key}>
            <Input
              className="font-mono text-[13px]"
              value={key}
              disabled={editing}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
              }}
            />
          </Field>

          {hasOptions && (
            <Field label="Options" required error={errors.options}>
              <div className="rounded-md border p-2">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {options.map((o) => (
                    <span key={o} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                      {o}
                      <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setOptions((x) => x.filter((v) => v !== o))} aria-label={`Remove ${o}`}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {!options.length && <span className="text-xs text-muted-foreground">No options yet</span>}
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-8"
                    value={optionText}
                    placeholder="Type an option, press Enter (comma separates many)"
                    onChange={(e) => setOptionText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addOption();
                      }
                    }}
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={addOption}>
                    Add
                  </Button>
                </div>
              </div>
            </Field>
          )}

          {(numeric || textual) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={numeric ? 'Minimum value' : 'Min length'} error={errors.min}>
                <Input type="number" value={min} onChange={(e) => setMin(e.target.value)} />
              </Field>
              <Field label={numeric ? 'Maximum value' : 'Max length'} error={errors.max}>
                <Input type="number" value={max} onChange={(e) => setMax(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Placeholder">
              <Input value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
            </Field>
            <Field label="Help text">
              <Input value={helpText} onChange={(e) => setHelpText(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            {[
              { label: 'Required', value: required, set: setRequired, hint: 'Must be filled in' },
              { label: 'Unique', value: isUnique, set: setUnique, hint: 'No two assets share a value' },
              { label: 'Show in tables', value: showInTable, set: setShowInTable, hint: 'Column when this type is filtered' },
              { label: 'Filterable', value: filterable, set: setFilterable, hint: 'Appears in spec filters' },
            ].map((t) => (
              <label key={t.label} className="flex cursor-pointer items-center justify-between gap-2 py-1">
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.hint}</span>
                </span>
                <Switch checked={t.value} onCheckedChange={t.set} />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!label.trim() || (hasOptions && !options.length)}>
              {editing ? 'Save field' : 'Add field'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
