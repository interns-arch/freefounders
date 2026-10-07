import { onboardingCreateSchema } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, FormSection, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EntityPicker } from '@/components/common/pickers';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Checkbox, Separator } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { queryClient, useAssetTypes } from '@/lib/queries';
import type { OnboardingKit } from '@/lib/types';
import type { FormProps } from '../quick-add/quick-add';

/** HR adds a new joiner: creates their employee record (status Joining) and the onboarding plan. */
export default function OnboardingForm({ open, onOpenChange, defaults }: FormProps) {
  const navigate = useNavigate();
  const kits = useQuery({ queryKey: ['onboarding-kits'], queryFn: () => api.get<OnboardingKit[]>('/onboarding-kits') });
  const types = useAssetTypes();
  // The joining kit is a one-time item every new joiner gets; ticked by default.
  const joiningKit = types.data?.find((t) => t.consumable && (t.code === 'JKT' || /joining kit/i.test(t.name)));
  const [withKit, setWithKit] = useState(true);
  const form = useZodForm(onboardingCreateSchema, {
    employeeCode: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    personalEmail: '',
    personalPhone: '',
    designation: '',
    departmentId: defaults?.departmentId ?? '',
    managerId: '',
    joinDate: '',
    notes: '',
    kitId: '',
    items: [],
  });
  const e = (n: string) => errorOf(form, n);
  const pick = (name: 'departmentId' | 'managerId') => ({
    value: (form.watch(name) as string) || null,
    onChange: (val: string | null) => form.setValue(name, val ?? '', { shouldDirty: true }),
  });
  const save = useMutation({ mutationFn: (body: unknown) => api.post<{ id: string; caseNumber: string }>('/onboarding', body) });

  const submit = form.handleSubmit(async (values) => {
    try {
      const kit = kits.data?.find((k) => k.id === values.kitId);
      const kitHasIt = !!joiningKit && !!kit?.items.some((i) => i.assetTypeId === joiningKit.id);
      const items = joiningKit && withKit && !kitHasIt ? [...(values.items ?? []), { assetTypeId: joiningKit.id, quantity: 1 }] : values.items;
      const r = await save.mutateAsync({ ...values, items });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['onboarding'] }), queryClient.invalidateQueries({ queryKey: ['employees'] })]);
      toast.success(`${r.caseNumber} created`, { description: 'Now add what they should get, then send it to IT.' });
      onOpenChange(false);
      navigate(`/onboarding/${r.id}`);
    } catch (err) {
      applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New joiner"
      description="Plan their first day: add them now, list what they should get, and IT prepares it before they join."
      onSubmit={submit}
      submitting={save.isPending}
      submitLabel="Create onboarding"
    >
      <FormSection title="Who is joining">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={e('firstName')}>
            <Input autoComplete="off" {...form.register('firstName')} />
          </Field>
          <Field label="Last name" error={e('lastName')}>
            <Input autoComplete="off" {...form.register('lastName')} />
          </Field>
          <Field label="Employee ID" required error={e('employeeCode')} hint="e.g. CT000150">
            <Input className="font-mono uppercase" placeholder="CT000150" {...form.register('employeeCode')} />
          </Field>
          <Field label="Joining date" required error={e('joinDate')}>
            <Input type="date" {...form.register('joinDate')} />
          </Field>
          <Field label="Designation" error={e('designation')}>
            <Input placeholder="Field Sales Executive" {...form.register('designation')} />
          </Field>
          <Field label="Reports to" error={e('managerId')}>
            <EntityPicker kind="EMPLOYEE" {...pick('managerId')} />
          </Field>
          <Field label="Department" error={e('departmentId')}>
            <EntityPicker kind="DEPARTMENT" {...pick('departmentId')} />
          </Field>
          <Field label="Official email" error={e('email')} hint="If already created">
            <Input type="email" autoCapitalize="none" {...form.register('email')} />
          </Field>
          <Field label="Personal phone" error={e('personalPhone')}>
            <Input type="tel" inputMode="tel" {...form.register('personalPhone')} />
          </Field>
        </div>
      </FormSection>
      <Separator />
      <FormSection title="What they should get">
        <Field label="Start from a kit" error={e('kitId')} hint={kits.data?.length ? 'Fills the list with that role’s usual items — you can change it next.' : 'No kits yet — you can save one from any onboarding.'}>
          <NativeSelect {...form.register('kitId')} disabled={!kits.data?.length}>
            <option value="">No kit — I’ll add items</option>
            {(kits.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.items.length} items)
              </option>
            ))}
          </NativeSelect>
        </Field>
        {joiningKit && (
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
            <Checkbox checked={withKit} onCheckedChange={(v) => setWithKit(v === true)} />
            <span>
              <span className="block text-sm font-medium">Include joining kit</span>
              <span className="text-xs text-muted-foreground">One-time welcome kit — theirs to keep, no return · {joiningKit.availableCount} in stock</span>
            </span>
          </label>
        )}
        <Field label="Notes for IT" error={e('notes')}>
          <Textarea rows={2} placeholder="Works from Karol Bagh; needs a laptop with Tally…" {...form.register('notes')} />
        </Field>
      </FormSection>
    </FormSheet>
  );
}
