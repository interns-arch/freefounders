import { ApiError, errorMessage, type MeAccount, useChangePassword, usePlatformMe } from '@freefounders/core';
import { usernameErrorOf, useSetUsername, useUsernameCheck } from '@freefounders/core/account';
import { UsernameField } from '@/features/account/parts';
import { Loader2 } from '@/components/icons';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { WeakPasswordNote } from '@/components/common/weak-password-note';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Logo } from '../shell-parts';

/**
 * Your username (accounts only, PLAN.md §21.5): add one or change it; it signs in to all your companies.
 * Admin-made logins have their username set by the company admin, so they do not see this.
 */
function UsernameCard({ account }: { account: MeAccount }) {
  const current = account.username ?? '';
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const save = useSetUsername();
  const changed = value.trim().toLowerCase() !== current;
  const check = useUsernameCheck(value, changed);
  const serverError = save.isError ? (usernameErrorOf(save.error) ?? errorMessage(save.error)) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!changed || !check.ok) return;
    save.mutate(value.trim(), { onSuccess: (res) => (setSaved(true), setValue(res.username)) });
  };

  return (
    <form onSubmit={submit} className="w-full max-w-[400px] space-y-4 rounded-xl border bg-card p-7 shadow-card-lg" aria-labelledby="username-title">
      <div className="space-y-1">
        <h2 id="username-title" className="text-xl font-bold tracking-tight">
          Username
        </h2>
        <p className="text-sm text-muted-foreground">
          {current ? (
            <>
              You sign in with <span className="font-semibold text-foreground">{current}</span>, or your email or mobile number.
            </>
          ) : (
            'Not set. Add one to sign in with it instead of your email or mobile number.'
          )}
        </p>
      </div>
      <UsernameField
        id="account-username"
        label={current ? 'New username' : 'Username'}
        value={value}
        onChange={(v) => {
          setValue(v);
          setSaved(false);
          save.reset();
        }}
        check={changed ? check : { state: 'empty', message: null }}
        serverError={serverError}
      />
      {saved && !changed && (
        <p role="status" className="rounded-md border border-success/20 bg-success/8 px-3 py-2 text-sm font-medium text-success">
          Username saved.
        </p>
      )}
      <Button type="submit" className="w-full" allowReadOnly disabled={!changed || !check.ok || save.isPending} loading={save.isPending}>
        {current ? 'Change username' : 'Add username'}
      </Button>
    </form>
  );
}

/** Change your own password, whenever you like (account menu). Never forced, also not after an admin set it (R7). */
export function AccountPage() {
  const navigate = useNavigate();
  const me = usePlatformMe();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (next.length < 6) return setProblem('Use at least 6 characters.');
    if (next !== again) return setProblem('The new passwords do not match.');
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setDone(true);
          setCurrent('');
          setNext('');
          setAgain('');
        },
        onError: (err) => setProblem(err instanceof ApiError && err.errors ? Object.values(err.errors)[0] : errorMessage(err)),
      },
    );
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background p-6">
      <Logo />
      {me.data?.account && <UsernameCard account={me.data.account} />}
      <form onSubmit={submit} className="w-full max-w-[400px] space-y-5 rounded-xl border bg-card p-7 shadow-card-lg" aria-labelledby="pw-title">
        <div className="space-y-1">
          <h1 id="pw-title" className="text-2xl font-bold tracking-tight">
            Change password
          </h1>
          <p className="text-sm text-muted-foreground">Your other devices will be signed out; this one stays signed in.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">Current password</Label>
          <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-new">New password</Label>
          <Input id="pw-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby="pw-new-weak" required />
          <WeakPasswordNote
            id="pw-new-weak"
            password={next}
            about={{ fullName: me.data?.person.fullName, email: me.data?.person.email, username: me.data?.person.employeeCode, companyName: me.data?.company.name }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-again">New password again</Label>
          <Input id="pw-again" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </div>
        {problem && (
          <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {problem}
          </p>
        )}
        {done && (
          <p role="status" className="rounded-md border border-success/20 bg-success/8 px-3 py-2 text-sm font-medium text-success">
            Password changed.
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={change.isPending}>
            {change.isPending && <Loader2 className="size-4 animate-spin" />}
            Save password
          </Button>
        </div>
      </form>
    </div>
  );
}
