import { employeeSchema } from '@eam/shared';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, FormSection, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EntityPicker } from '@/features/assets/components/pickers';
import { ManageInPeople } from '@/features/admin/manage-in-people';
import { Input, Textarea } from '@/components/ui/input';
import { Separator } from '@/components/ui/primitives';
import { errorMessage } from '@kaampilot/core';
import { useAssetsCache, useSaveEmployee } from '@kaampilot/core/assets';
import type { EmployeeDetail } from '@kaampilot/core/assets';
import { formatDate } from '@/lib/utils';
import type { FormProps } from '../quick-add/quick-add';

const v = (x: unknown) => (x === null || x === undefined ? '' : x);

/** What Assets itself keeps about a person (PLAN.md §26); who they are comes from Admin → People. */
const assetsFieldsSchema = employeeSchema.pick({ personalEmail: true, personalPhone: true, locationId: true, notes: true });

/**
 * Edit a person's Assets details: work location, personal contacts and notes. Their name, employee ID, official email /
 * phone, designation, department, manager and joining date are shown read-only: they change only in Admin → People
 * (PLAN.md §26), and nobody is added here.
 */
export default function EmployeeForm({ open, onOpenChange, record }: FormProps) {
  const emp = record as EmployeeDetail | undefined;
  const form = useZodForm(assetsFieldsSchema, {
    personalEmail: v(emp?.personalEmail),
    personalPhone: v(emp?.personalPhone),
    locationId: v(emp?.locationId),
    notes: v(emp?.notes),
  });
  const save = useSaveEmployee();
  const cache = useAssetsCache();
  const e = (n: string) => errorOf(form, n);

  const submit = form.handleSubmit(async (values) => {
    if (!emp) return;
    try {
      await save.mutateAsync({ id: emp.id, body: values });
      await cache.invalidate('employees', 'employee');
      toast.success('Saved');
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  if (!emp) return null;
  const facts: Array<[string, string | null | undefined]> = [
    ['Employee ID', emp.employeeCode],
    ['Designation', emp.designation],
    ['Department', emp.departmentName],
    ['Reports to', emp.managerName],
    ['Official email', emp.email],
    ['Official phone', emp.phone],
    ['Joined', emp.joinDate ? formatDate(emp.joinDate) : null],
  ];

  return (
    <FormSheet errors={form.formState.errors} open={open} onOpenChange={onOpenChange} title={`Edit ${emp.fullName}`} onSubmit={submit} submitting={save.isPending} submitLabel="Save changes">
      <FormSection title="Person">
        <dl className="grid gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate font-medium">{value || '—'}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Name, ID, contacts, department, manager and joining date are managed in Admin → People.{' '}
          <ManageInPeople personId={emp.login?.platformPersonId} query={emp.email || emp.employeeCode} />
        </p>
      </FormSection>
      <Separator />
      <FormSection title="In Assets">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work location" error={e('locationId')}>
            <EntityPicker kind="LOCATION" value={(form.watch('locationId') as string) || null} onChange={(val: string | null) => form.setValue('locationId', val ?? '', { shouldDirty: true })} />
          </Field>
          <Field label="Personal phone" error={e('personalPhone')}>
            <Input type="tel" inputMode="tel" {...form.register('personalPhone')} />
          </Field>
          <Field label="Personal email" error={e('personalEmail')} className="sm:col-span-2">
            <Input type="email" inputMode="email" autoCapitalize="none" {...form.register('personalEmail')} />
          </Field>
        </div>
        <Field label="Notes" error={e('notes')}>
          <Textarea rows={2} {...form.register('notes')} />
        </Field>
      </FormSection>
    </FormSheet>
  );
}
