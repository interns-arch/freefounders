import { humanize, MAINTENANCE_TYPES, maintenanceSchema } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EntityPicker } from '@/components/common/pickers';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { invalidateAssetData } from '@/lib/queries';
import type { FormProps } from '../quick-add/quick-add';

export default function MaintenanceForm({ open, onOpenChange, defaults }: FormProps) {
  const form = useZodForm(maintenanceSchema, {
    assetId: defaults?.assetId ?? '',
    type: 'REPAIR',
    title: '',
    description: '',
    vendorId: '',
    scheduledDate: '',
    cost: '',
    startNow: true,
  });
  const e = (n: string) => errorOf(form, n);
  const startNow = form.watch('startNow');
  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ number: string }>('/maintenance', body) });

  const submit = form.handleSubmit(async (values) => {
    try {
      const m = await save.mutateAsync(values);
      await invalidateAssetData();
      toast.success(`Maintenance ${m.number} ${values.startNow ? 'started' : 'scheduled'}`);
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} size="sm" title="Log maintenance" description="Repairs, servicing, inspections and calibration." onSubmit={submit} submitting={save.isPending} submitLabel={startNow ? 'Start maintenance' : 'Schedule'}>
      <div className="grid gap-4">
        <Field label="Asset" required error={e('assetId')}>
          <EntityPicker
            kind="asset"
            value={(form.watch('assetId') as string) || null}
            selectedLabel={defaults?.assetLabel}
            assetFilter={{ status: 'AVAILABLE,ASSIGNED,RETURNED,IN_INVENTORY' }}
            onChange={(v) => form.setValue('assetId', v ?? '', { shouldValidate: true })}
          />
        </Field>
        <Field label="Title" required error={e('title')}>
          <Input placeholder="Screen replacement" {...form.register('title')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type" error={e('type')}>
            <NativeSelect {...form.register('type')}>
              {MAINTENANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Estimated cost (₹)" error={e('cost')}>
            <Input type="number" min={0} step="any" {...form.register('cost')} />
          </Field>
        </div>
        <Field label="Service vendor" error={e('vendorId')}>
          <EntityPicker kind="VENDOR" value={(form.watch('vendorId') as string) || null} onChange={(v) => form.setValue('vendorId', v ?? '')} />
        </Field>
        <Controller
          control={form.control}
          name="startNow"
          render={({ field }) => (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Start now</span>
                <span className="text-xs text-muted-foreground">The asset moves to “In maintenance” immediately.</span>
              </span>
              <Switch checked={!!field.value} onCheckedChange={field.onChange} />
            </label>
          )}
        />
        {!startNow && (
          <Field label="Scheduled for" error={e('scheduledDate')}>
            <Input type="date" {...form.register('scheduledDate')} />
          </Field>
        )}
        <Field label="Details" error={e('description')}>
          <Textarea rows={3} {...form.register('description')} />
        </Field>
      </div>
    </FormSheet>
  );
}
