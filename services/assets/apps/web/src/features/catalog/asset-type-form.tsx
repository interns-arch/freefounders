import { assetTypeSchema } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { Hash, Package } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { queryClient, useCategories } from '@/lib/queries';
import type { AssetType } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { FormProps } from '../quick-add/quick-add';
import { IconPicker } from './pickers';

export default function AssetTypeForm({ open, onOpenChange, record, defaults }: FormProps) {
  const t = record as AssetType | undefined;
  const editing = !!t;
  const navigate = useNavigate();
  const categories = useCategories();
  const form = useZodForm(assetTypeSchema, {
    categoryId: t?.categoryId ?? defaults?.categoryId ?? '',
    name: t?.name ?? '',
    code: t?.code ?? '',
    icon: t?.icon ?? 'box',
    description: t?.description ?? '',
    trackingMode: t?.trackingMode ?? 'INDIVIDUAL',
    consumable: t?.consumable ?? false,
  });
  const e = (n: string) => errorOf(form, n);
  const categoryId = form.watch('categoryId') as string;
  const color = categories.data?.find((c) => c.id === categoryId)?.color;
  const mode = form.watch('trackingMode');
  const save = useMutation({ mutationFn: (body: unknown) => (editing ? api.patch<AssetType>(`/asset-types/${t.id}`, body) : api.post<AssetType>('/asset-types', body)) });

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
        queryClient.invalidateQueries({ queryKey: ['asset-type'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
      ]);
      onOpenChange(false);
      if (editing) toast.success('Asset type updated');
      else {
        toast.success(`"${saved.name}" created — now add its fields`);
        navigate(`/settings/catalog?category=${saved.categoryId}&type=${saved.id}`);
      }
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} size="sm" title={editing ? 'Edit asset type' : 'New asset type'} description="Any kind of asset: define it once, then add its own fields." onSubmit={submit} submitting={save.isPending}>
      <div className="grid gap-4">
        <Field label="Category" required error={e('categoryId')}>
          <NativeSelect {...form.register('categoryId')}>
            <option value="">Select a category…</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Name" required error={e('name')}>
          <Input
            placeholder="Drone"
            {...form.register('name', {
              onChange: (ev) => {
                if (!editing && !form.getFieldState('code').isDirty) {
                  form.setValue('code', String(ev.target.value).replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase());
                }
              },
            })}
          />
        </Field>
        <Field label="Tag prefix" required error={e('code')} hint="Asset tags will look like PREFIX-000001">
          <Input className="font-mono uppercase" placeholder="DRN" {...form.register('code')} />
        </Field>
        <Field label="How is it tracked?" hint={editing && t.assetCount > 0 ? 'Cannot change once assets exist.' : undefined}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'INDIVIDUAL', icon: Package, title: 'Individually', text: 'Each item has its own tag (laptop, car)' },
              { v: 'QUANTITY', icon: Hash, title: 'By quantity', text: 'A stock of units (gloves, licence seats)' },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                disabled={editing && t.assetCount > 0}
                onClick={() => {
                  form.setValue('trackingMode', o.v as 'INDIVIDUAL' | 'QUANTITY');
                  if (o.v === 'INDIVIDUAL') form.setValue('consumable', false);
                }}
                className={cn(
                  'flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60',
                  mode === o.v && 'border-primary bg-primary/5 ring-1 ring-primary/30',
                )}
              >
                <o.icon className="size-4 text-primary" />
                <span className="text-sm font-medium">{o.title}</span>
                <span className="text-xs text-muted-foreground">{o.text}</span>
              </button>
            ))}
          </div>
        </Field>
        {mode === 'QUANTITY' && (
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">One-time item — no return</span>
              <span className="text-xs text-muted-foreground">Given away for good (joining kit, stationery). Stock goes down; nothing to return or recover at exit.</span>
            </span>
            <Switch checked={!!form.watch('consumable')} onCheckedChange={(v) => form.setValue('consumable', v)} />
          </label>
        )}
        <Field label="Icon">
          <IconPicker value={form.watch('icon') as string} color={color} onChange={(v) => form.setValue('icon', v)} />
        </Field>
        <Field label="Description" error={e('description')}>
          <Textarea rows={2} {...form.register('description')} />
        </Field>
      </div>
    </FormSheet>
  );
}
