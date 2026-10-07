import { humanize, PRIORITIES, requestSchema } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { Combobox, EntityPicker } from '@/components/common/pickers';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { queryClient, useAssetTypes } from '@/lib/queries';
import type { FormProps } from '../quick-add/quick-add';

export default function RequestForm({ open, onOpenChange, defaults }: FormProps) {
  const { can, me } = useAuth();
  const forOthers = can('request:approve', 'request:fulfil');
  const types = useAssetTypes();
  const form = useZodForm(requestSchema, {
    employeeId: defaults?.employeeId ?? me?.employee?.id ?? '',
    assetTypeId: defaults?.assetTypeId ?? '',
    itemName: '',
    quantity: 1,
    priority: 'MEDIUM',
    neededBy: '',
    reason: '',
  });
  const e = (n: string) => errorOf(form, n);
  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ number: string }>('/requests', body) });

  const submit = form.handleSubmit(async (values) => {
    try {
      const r = await save.mutateAsync(values);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['requests'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
      toast.success(`Request ${r.number} submitted`, { description: 'Approvers have been notified.' });
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} size="sm" title="Request an asset" description="Ask for anything you need for work — IT will be notified." onSubmit={submit} submitting={save.isPending} submitLabel="Submit request">
      <div className="grid gap-4">
        {forOthers && (
          <Field label="For employee" required error={e('employeeId')}>
            <EntityPicker kind="EMPLOYEE" value={(form.watch('employeeId') as string) || null} selectedLabel={me?.employee?.fullName} onChange={(v) => form.setValue('employeeId', v ?? '')} />
          </Field>
        )}
        <Field label="What do you need?" required error={e('assetTypeId')} hint="Pick from the list, or type anything and tap “Request …”">
          <Combobox
            value={(form.watch('assetTypeId') as string) || (form.watch('itemName') ? '__custom__' : null)}
            selectedLabel={(form.watch('itemName') as string) || null}
            onChange={(v) => {
              form.setValue('itemName', '');
              form.setValue('assetTypeId', v ?? '', { shouldValidate: true });
            }}
            onCreate={(text) => {
              if (!text) return;
              form.setValue('assetTypeId', '');
              form.setValue('itemName', text, { shouldValidate: true });
              form.clearErrors('assetTypeId');
            }}
            createWithoutText={false}
            createLabel={(t) => `Request “${t}”`}
            options={(types.data ?? []).map((t) => ({
              value: t.id,
              label: t.name,
              description: `${t.categoryName} · ${t.availableCount} available`,
              icon: <AssetIcon icon={t.icon ?? t.categoryIcon} color={t.categoryColor} size="sm" />,
            }))}
            placeholder="Monitor, headset, SIM card…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity" error={e('quantity')}>
            <Input type="number" min={1} {...form.register('quantity')} />
          </Field>
          <Field label="Priority" error={e('priority')}>
            <NativeSelect {...form.register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Needed by" error={e('neededBy')}>
          <Input type="date" {...form.register('neededBy')} />
        </Field>
        <Field label="Reason" required error={e('reason')}>
          <Textarea rows={3} placeholder="Why is it needed?" {...form.register('reason')} />
        </Field>
      </div>
    </FormSheet>
  );
}
