import { companySchema, departmentSchema, humanize, LOCATION_TYPES, locationSchema, vendorSchema } from '@eam/shared';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import type { ZodType } from 'zod';
import { applyServerErrors, errorOf, Field, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EntityPicker } from '@/features/assets/components/pickers';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import { errorMessage } from '@kaampilot/core';
import { type OrgPath, useAssetsCache, useSaveOrg } from '@kaampilot/core/assets';
import type { FormProps } from '../quick-add/quick-add';

export type OrgKind = 'company' | 'department' | 'location' | 'vendor';

export const ORG_META: Record<OrgKind, { path: OrgPath; label: string; schema: ZodType; fields: string[] }> = {
  company: { path: 'companies', label: 'Company', schema: companySchema, fields: ['name', 'code', 'legalName', 'address'] },
  department: { path: 'departments', label: 'Department', schema: departmentSchema, fields: ['name', 'code', 'companyId', 'parentId'] },
  location: { path: 'locations', label: 'Location', schema: locationSchema, fields: ['name', 'code', 'type', 'parentId', 'companyId', 'address', 'isStore'] },
  vendor: { path: 'vendors', label: 'Vendor', schema: vendorSchema, fields: ['name', 'code', 'contactName', 'email', 'phone', 'website', 'address', 'notes'] },
};

const LABELS: Record<string, string> = {
  name: 'Name',
  code: 'Code',
  legalName: 'Legal name',
  address: 'Address',
  companyId: 'Company',
  parentId: 'Parent',
  type: 'Type',
  isStore: 'Store / warehouse',
  contactName: 'Contact person',
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  notes: 'Notes',
};

export default function OrgForm({ kind, open, onOpenChange, record, defaults }: FormProps & { kind: OrgKind }) {
  const meta = ORG_META[kind];
  const editing = !!record;
  const initial: Record<string, unknown> = {};
  for (const f of meta.fields) initial[f] = record?.[f] ?? defaults?.[f] ?? (f === 'isStore' ? false : f === 'type' ? 'OFFICE' : '');
  const form = useZodForm(meta.schema, initial);
  const e = (n: string) => errorOf(form, n);
  const cache = useAssetsCache();
  const save = useSaveOrg();

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ path: meta.path, id: editing ? record!.id : null, body: values });
      await cache.invalidate('lookup', ['org', meta.path]);
      toast.success(`${meta.label} ${editing ? 'updated' : 'added'}`);
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  const render = (f: string) => {
    switch (f) {
      case 'companyId':
        return <EntityPicker kind="COMPANY" value={(form.watch('companyId') as string) || null} onChange={(v) => form.setValue('companyId', v ?? '')} />;
      case 'parentId':
        return (
          <EntityPicker
            kind={kind === 'department' ? 'DEPARTMENT' : 'LOCATION'}
            value={(form.watch('parentId') as string) || null}
            onChange={(v) => form.setValue('parentId', v ?? '')}
            placeholder={kind === 'location' ? 'e.g. the building this floor is in' : 'None'}
          />
        );
      case 'type':
        return (
          <NativeSelect {...form.register('type')}>
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </NativeSelect>
        );
      case 'isStore':
        return (
          <Controller
            control={form.control}
            name="isStore"
            render={({ field }) => (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
                <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                Assets can be kept here as inventory
              </label>
            )}
          />
        );
      case 'address':
      case 'notes':
        return <Textarea rows={2} {...form.register(f)} />;
      case 'code':
        return <Input className="font-mono uppercase" {...form.register(f)} />;
      default:
        return <Input type={f === 'email' ? 'email' : 'text'} {...form.register(f)} />;
    }
  };

  return (
    <FormSheet errors={form.formState.errors} open={open} onOpenChange={onOpenChange} size="sm" title={editing ? `Edit ${meta.label.toLowerCase()}` : `Add ${meta.label.toLowerCase()}`} onSubmit={submit} submitting={save.isPending}>
      <div className="grid gap-4">
        {meta.fields.map((f) => (
          <Field key={f} label={LABELS[f]} required={f === 'name'} error={e(f)}>
            {render(f)}
          </Field>
        ))}
      </div>
    </FormSheet>
  );
}
