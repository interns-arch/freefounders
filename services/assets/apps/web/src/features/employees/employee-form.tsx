import { employeeSchema } from '@eam/shared';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { applyServerErrors, errorOf, Field, FormSection, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { EntityPicker } from '@/components/common/pickers';
import { Input, Textarea } from '@/components/ui/input';
import { Separator, Switch } from '@/components/ui/primitives';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryClient, useCompanies } from '@/lib/queries';
import type { EmployeeDetail } from '@/lib/types';
import type { FormProps } from '../quick-add/quick-add';
import { type AccessInput, type Credentials, CredentialsDialog, PasswordInput, RoleSelect } from './access';

const v = (x: unknown) => (x === null || x === undefined ? '' : x);

export default function EmployeeForm({ open, onOpenChange, record, defaults }: FormProps) {
  const emp = record as EmployeeDetail | undefined;
  const editing = !!emp;
  const navigate = useNavigate();
  const companies = useCompanies();
  const { can } = useAuth();
  const canGiveLogin = !editing && can('user:manage');
  const [giveLogin, setGiveLogin] = useState(false);
  const [access, setAccess] = useState<AccessInput>({ roleId: '', username: '', email: '', password: '' });
  const [accessErrors, setAccessErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ fullName: string; credentials: Credentials } | null>(null);
  // The login ID follows the employee ID until someone types their own (or clears it).
  const [usernameEdited, setUsernameEdited] = useState(false);
  const setAccessField = (k: keyof AccessInput) => (v: string) => setAccess((a) => ({ ...a, [k]: v }));
  const form = useZodForm(employeeSchema, {
    employeeCode: emp?.employeeCode ?? '',
    firstName: emp?.firstName ?? '',
    lastName: v(emp?.lastName),
    email: v(emp?.email),
    phone: v(emp?.phone),
    personalEmail: v(emp?.personalEmail),
    personalPhone: v(emp?.personalPhone),
    designation: v(emp?.designation),
    companyId: v(emp?.companyId ?? defaults?.companyId ?? companies.data?.[0]?.id),
    departmentId: v(emp?.departmentId ?? defaults?.departmentId),
    locationId: v(emp?.locationId ?? defaults?.locationId),
    managerId: v(emp?.managerId),
    joinDate: v(emp?.joinDate),
    notes: v(emp?.notes),
  });
  const save = useMutation({
    mutationFn: (body: unknown) =>
      editing ? api.patch<EmployeeDetail>(`/employees/${emp.id}`, body) : api.post<EmployeeDetail & { credentials: Credentials | null }>('/employees', body),
  });
  const e = (n: string) => errorOf(form, n);
  const employeeCode = ((form.watch('employeeCode') as string) || '').trim().toLowerCase();
  const username = usernameEdited ? access.username : employeeCode;
  const pick = (name: 'companyId' | 'departmentId' | 'locationId' | 'managerId') => ({
    value: (form.watch(name) as string) || null,
    onChange: (val: string | null) => form.setValue(name, val ?? '', { shouldDirty: true }),
  });

  const submit = form.handleSubmit(async (values) => {
    setAccessErrors({});
    if (giveLogin && access.password && access.password.length < 8) {
      setAccessErrors({ password: 'At least 8 characters' });
      return;
    }
    try {
      const body = canGiveLogin && giveLogin ? { ...values, access: { ...access, username: usernameEdited ? access.username : '', email: access.email || values.email || '' } } : values;
      const saved = await save.mutateAsync(body);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['employees'] }), queryClient.invalidateQueries({ queryKey: ['employee'] })]);
      toast.success(editing ? 'Employee updated' : `${saved.fullName} added`, {
        action: editing ? undefined : { label: 'Open', onClick: () => navigate(`/employees/${saved.id}`) },
      });
      onOpenChange(false);
      const credentials = (saved as { credentials?: Credentials | null }).credentials;
      if (credentials) setCreated({ fullName: saved.fullName, credentials });
    } catch (err) {
      // Login fields come back without a prefix; show them in the Portal access section.
      const loginError = giveLogin && err instanceof ApiError && err.errors && (['roleId', 'username', 'password'].some((k) => err.errors![k]) || /login/i.test(err.errors.email ?? ''));
      if (loginError) setAccessErrors((err as ApiError).errors ?? {});
      else applyServerErrors(form, err);
      toast.error(errorMessage(err));
    }
  });

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${emp.fullName}` : 'Add employee'} onSubmit={submit} submitting={save.isPending} submitLabel={editing ? 'Save changes' : 'Add employee'}>
      <FormSection title="Person">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={e('firstName')}>
            <Input autoComplete="off" {...form.register('firstName')} />
          </Field>
          <Field label="Last name" error={e('lastName')}>
            <Input autoComplete="off" {...form.register('lastName')} />
          </Field>
          <Field label="Employee ID" required error={e('employeeCode')} hint="e.g. CT000099 — also their login ID">
            <Input className="font-mono uppercase" placeholder="CT000099" {...form.register('employeeCode')} />
          </Field>
          <Field label="Designation" error={e('designation')}>
            <Input placeholder="Sales Executive" {...form.register('designation')} />
          </Field>
          <Field label="Official phone" error={e('phone')} hint="Company SIM, if any">
            <Input type="tel" inputMode="tel" {...form.register('phone')} />
          </Field>
          <Field label="Personal phone" error={e('personalPhone')}>
            <Input type="tel" inputMode="tel" {...form.register('personalPhone')} />
          </Field>
          <Field label="Official email" error={e('email')}>
            <Input type="email" inputMode="email" autoCapitalize="none" {...form.register('email')} />
          </Field>
          <Field label="Personal email" error={e('personalEmail')}>
            <Input type="email" inputMode="email" autoCapitalize="none" {...form.register('personalEmail')} />
          </Field>
        </div>
      </FormSection>
      <Separator />
      <FormSection title="Organisation">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" error={e('departmentId')}>
            <EntityPicker kind="DEPARTMENT" {...pick('departmentId')} />
          </Field>
          <Field label="Reports to" error={e('managerId')}>
            <EntityPicker kind="EMPLOYEE" selectedLabel={emp?.managerName} {...pick('managerId')} />
          </Field>
          <Field label="Joining date" error={e('joinDate')}>
            <Input type="date" {...form.register('joinDate')} />
          </Field>
        </div>
        <Field label="Notes" error={e('notes')}>
          <Textarea rows={2} {...form.register('notes')} />
        </Field>
      </FormSection>
      {canGiveLogin && (
        <>
          <Separator />
          <FormSection title="Portal access">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Give a login now</span>
                <span className="text-xs text-muted-foreground">Choose their role and sign-in details. You can also do this later from their page.</span>
              </span>
              <Switch checked={giveLogin} onCheckedChange={setGiveLogin} />
            </label>
            {giveLogin && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role" required error={accessErrors.roleId} className="sm:col-span-2">
                  <RoleSelect value={access.roleId} onChange={setAccessField('roleId')} />
                </Field>
                <Field label="Login ID" error={accessErrors.username} hint="Filled from the employee ID · change it if you like (blank = employee ID)">
                  <Input
                    value={username}
                    onChange={(ev) => {
                      setUsernameEdited(true);
                      setAccessField('username')(ev.target.value.replace(/\s/g, ''));
                    }}
                    placeholder="amit.kumar"
                    autoComplete="off"
                    autoCapitalize="none"
                  />
                </Field>
                <Field label="Email for sign-in" error={accessErrors.email} hint="Optional · blank = official email">
                  <Input type="email" value={access.email} onChange={(ev) => setAccessField('email')(ev.target.value)} placeholder={(form.watch('email') as string) || 'name@cartrends.in'} autoComplete="off" />
                </Field>
                <Field label="Password" error={accessErrors.password} hint="At least 8 characters · blank = generated" className="sm:col-span-2">
                  <PasswordInput value={access.password} onChange={setAccessField('password')} />
                </Field>
              </div>
            )}
          </FormSection>
        </>
      )}
      {created && <CredentialsDialog employee={{ fullName: created.fullName }} credentials={created.credentials} onClose={() => setCreated(null)} />}
    </FormSheet>
  );
}
