import { ApiError, errorMessage, useChangePassword, usePlatformMe } from '@freefounders/core';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { WeakPasswordNote } from '@/components/common/weak-password-note';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Logo } from '../shell-parts';

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
