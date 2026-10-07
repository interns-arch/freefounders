import { Copy, Eye, EyeOff, KeyRound, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQrLinks } from '@/components/common/codes';
import { Field } from '@/components/common/form';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, errorMessage } from '@/lib/api';
import { useCompanyName } from '@/lib/config';
import { useRoles } from '@/lib/queries';
import type { EmployeeDetail } from '@/lib/types';

export interface Credentials {
  loginId: string;
  employeeCode: string;
  email: string | null;
  password: string;
  created: boolean;
}

export interface AccessInput {
  roleId: string;
  username: string;
  email: string;
  password: string;
}

export const generatePassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const raw = Array.from(bytes, (b) => chars[b % chars.length]).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
};

/** Password box with show/hide and a Generate button. */
export function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <Input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" className="font-mono" />
      <Button type="button" variant="outline" size="icon" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>
        {show ? <EyeOff /> : <Eye />}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onChange(generatePassword());
          setShow(true);
        }}
      >
        Generate
      </Button>
    </div>
  );
}

/** Role picker; defaults to "Employee" (view only) when nothing is chosen yet. */
export function RoleSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const roles = useRoles();
  useEffect(() => {
    if (!value && roles.data?.length) onChange(roles.data.find((r) => r.name === 'Employee')?.id ?? roles.data[0].id);
  }, [value, roles.data, onChange]);
  const current = roles.data?.find((r) => r.id === value);
  return (
    <div className="grid gap-1">
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} disabled={roles.isLoading}>
        {(roles.data ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </NativeSelect>
      {current?.description && <p className="text-xs text-muted-foreground">{current.description}</p>}
    </div>
  );
}

/** IT picks the role, login ID, email and password (or generates a password). */
export function AccessDialog({ employee: e, saving, error, onSave, onClose }: { employee: EmployeeDetail; saving: boolean; error: unknown; onSave: (v: AccessInput) => void; onClose: () => void }) {
  const [roleId, setRoleId] = useState(e.login?.roleId ?? '');
  const [username, setUsername] = useState(e.login?.username ?? '');
  const [email, setEmail] = useState(e.login?.email ?? e.email ?? '');
  const [password, setPassword] = useState('');
  const errors = error instanceof ApiError ? (error.errors ?? {}) : {};
  const general = error && !Object.keys(errors).length ? errorMessage(error) : null;
  const reset = !!e.login?.isActive;
  const tooShort = password.length > 0 && password.length < 8;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reset ? 'Change login / password' : `Give ${e.fullName} a login`}</DialogTitle>
          <DialogDescription>
            They can sign in with the login ID, their employee ID <span className="font-mono">{e.employeeCode}</span>, or the email.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!tooShort) onSave({ roleId, username, email, password });
          }}
        >
          <Field label="Role" error={errors.roleId} hint="What they can see and do">
            <RoleSelect value={roleId} onChange={setRoleId} />
          </Field>
          <Field label="Login ID" error={errors.username} hint="Optional · e.g. amit.kumar — letters, numbers, dot, dash">
            <Input value={username} onChange={(v) => setUsername(v.target.value.replace(/\s/g, ''))} placeholder={e.employeeCode} autoComplete="off" autoCapitalize="none" />
          </Field>
          <Field label="Email for sign-in" error={errors.email} hint="Optional · they can type this instead of the login ID">
            <Input type="email" value={email} onChange={(v) => setEmail(v.target.value)} placeholder="name@cartrends.in" autoComplete="off" />
          </Field>
          <Field
            label={reset ? 'New password' : 'Password'}
            error={errors.password ?? (tooShort ? 'At least 8 characters' : undefined)}
            hint={reset ? 'Leave blank to generate one · they are signed out everywhere' : 'At least 8 characters · leave blank to generate one'}
          >
            <PasswordInput value={password} onChange={setPassword} />
          </Field>
          {general && <p className="text-sm text-destructive">{general}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <KeyRound /> {reset ? 'Save' : 'Create login'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shown once after giving a login: IT copies or shares it (e.g. on WhatsApp). */
export function CredentialsDialog({ employee, credentials, onClose }: { employee: { fullName: string }; credentials: Credentials | null; onClose: () => void }) {
  const company = useCompanyName();
  const links = useQrLinks();
  const text = credentials
    ? `${company.short ?? 'Asset Portal'} — asset portal login for ${employee.fullName}\n${links.base}\nLogin ID: ${credentials.loginId}${credentials.email ? ` (or ${credentials.email})` : ''}\nPassword: ${credentials.password}\nPlease change your password after signing in.`
    : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Couldn’t copy — select the text instead');
    }
  };
  return (
    <Dialog open={!!credentials} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{credentials?.created ? 'Login created' : 'New password'}</DialogTitle>
          <DialogDescription>Share this with {employee.fullName}. The password is shown only now — it is stored encrypted and can’t be looked up later.</DialogDescription>
        </DialogHeader>
        {credentials && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Login ID</span>
              <span className="font-mono font-semibold">{credentials.loginId}</span>
            </div>
            {credentials.loginId !== credentials.employeeCode && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">or employee ID</span>
                <span className="font-mono">{credentials.employeeCode}</span>
              </div>
            )}
            {credentials.email && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">or email</span>
                <span className="truncate">{credentials.email}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Password</span>
              <span className="font-mono text-base font-semibold select-all">{credentials.password}</span>
            </div>
          </div>
        )}
        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          {typeof navigator.share === 'function' ? (
            <Button variant="outline" onClick={() => void navigator.share({ text }).catch(() => {})}>
              <Share2 /> Share
            </Button>
          ) : (
            <Button variant="outline" onClick={copy}>
              <Copy /> Copy
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
