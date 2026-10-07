import { humanize, PRIORITIES, TICKET_TYPES, ticketSchema } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EntityPicker } from '@/components/common/pickers';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { FormProps } from '../quick-add/quick-add';

export default function TicketForm({ open, onOpenChange, defaults }: FormProps) {
  const form = useZodForm(ticketSchema, {
    title: '',
    description: '',
    assetId: defaults?.assetId ?? '',
    type: defaults?.type ?? 'ISSUE',
    priority: 'MEDIUM',
  });
  const e = (n: string) => errorOf(form, n);
  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ number: string }>('/tickets', body) });

  const submit = form.handleSubmit(async (values) => {
    try {
      const t = await save.mutateAsync(values);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['tickets'] }), queryClient.invalidateQueries({ queryKey: ['history'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
      toast.success(`Ticket ${t.number} raised`, { description: 'The support team has been notified.' });
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} size="sm" title="Raise a ticket" description="Report a problem, damage or loss." onSubmit={submit} submitting={save.isPending} submitLabel="Raise ticket">
      <div className="grid gap-4">
        <Field label="Title" required error={e('title')}>
          <Input placeholder="Laptop won’t charge" {...form.register('title')} />
        </Field>
        <Field label="Asset" error={e('assetId')} hint="Optional — which asset is affected?">
          <EntityPicker kind="asset" value={(form.watch('assetId') as string) || null} selectedLabel={defaults?.assetLabel} onChange={(v) => form.setValue('assetId', v ?? '')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type" error={e('type')}>
            <NativeSelect {...form.register('type')}>
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </NativeSelect>
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
        <Field label="Details" error={e('description')}>
          <Textarea rows={4} placeholder="What happened? Since when?" {...form.register('description')} />
        </Field>
      </div>
    </FormSheet>
  );
}
