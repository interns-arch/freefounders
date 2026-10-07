import { categorySchema } from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { Input, Textarea } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { Category } from '@/lib/types';
import type { FormProps } from '../quick-add/quick-add';
import { ColorPicker, IconPicker } from './pickers';

export default function CategoryForm({ open, onOpenChange, record }: FormProps) {
  const cat = record as Category | undefined;
  const editing = !!cat;
  const navigate = useNavigate();
  const form = useZodForm(categorySchema, {
    name: cat?.name ?? '',
    code: cat?.code ?? '',
    icon: cat?.icon ?? 'box',
    color: cat?.color ?? 'indigo',
    description: cat?.description ?? '',
  });
  const e = (n: string) => errorOf(form, n);
  const save = useMutation({ mutationFn: (body: unknown) => (editing ? api.patch<Category>(`/categories/${cat.id}`, body) : api.post<Category>('/categories', body)) });
  const name = form.watch('name');

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(values);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['categories'] }), queryClient.invalidateQueries({ queryKey: ['asset-types'] })]);
      toast.success(editing ? 'Category updated' : `Category "${saved.name}" created`);
      onOpenChange(false);
      if (!editing) navigate(`/settings/catalog?category=${saved.id}`);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} size="sm" title={editing ? 'Edit category' : 'New category'} description="Groups asset types, e.g. IT, Vehicles, Safety." onSubmit={submit} submitting={save.isPending}>
      <div className="grid gap-4">
        <Field label="Name" required error={e('name')}>
          <Input
            placeholder="Vehicles"
            {...form.register('name', {
              onChange: (ev) => {
                if (!editing && !form.getFieldState('code').isDirty) {
                  form.setValue('code', String(ev.target.value).replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase());
                }
              },
            })}
          />
        </Field>
        <Field label="Code" required error={e('code')} hint="Short unique code">
          <Input className="font-mono uppercase" placeholder="VEH" {...form.register('code')} />
        </Field>
        <Field label="Colour">
          <ColorPicker value={form.watch('color') as string} onChange={(v) => form.setValue('color', v)} />
        </Field>
        <Field label="Icon">
          <IconPicker value={form.watch('icon') as string} color={form.watch('color') as string} onChange={(v) => form.setValue('icon', v)} />
        </Field>
        <Field label="Description" error={e('description')}>
          <Textarea rows={2} placeholder={name ? `What belongs in ${name}?` : undefined} {...form.register('description')} />
        </Field>
      </div>
    </FormSheet>
  );
}
