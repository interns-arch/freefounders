import { errorMessage, session, useSignIn } from '@freefounders/core';
import { CheckCircle2, Loader2, Package, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Logo } from '../shell-parts';
import { safeNext } from '../session-guard';

const POINTS = [
  { icon: CheckCircle2, text: 'Tasks, checklists and approvals' },
  { icon: ShieldCheck, text: 'Attendance and leave' },
  { icon: Package, text: 'Assets, joiners and exits' },
];

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const next = safeNext(params.get('next'));

  // Already signed in (another tab, or the refresh cookie still works): go straight on.
  useEffect(() => {
    void session.refresh().then((ok) => ok && navigate(next ?? '/', { replace: true }));
  }, [navigate, next]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate({ login: login.trim(), password }, { onSuccess: () => navigate(next ?? '/', { replace: true }) });
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Logo inverted />
        <div className="max-w-md space-y-6">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Run your whole team from one place.</h1>
          <ul className="space-y-3 text-primary-foreground/85">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3">
                <p.icon className="size-5 shrink-0" aria-hidden />
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/70">One sign-in for every FreeFounders app.</p>
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-primary-foreground/10" />
      </aside>
      <main className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" aria-labelledby="signin-title">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="space-y-1.5">
            <h1 id="signin-title" className="text-2xl font-semibold tracking-tight">
              Sign in
            </h1>
            <p className="text-sm text-muted-foreground">One login for Tasks and Assets.</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login">Email, username or employee ID</Label>
              <Input id="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
          </div>
          {signIn.isError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage(signIn.error)}
            </p>
          )}
          <Button type="submit" className="w-full" size="lg" disabled={signIn.isPending || !login || !password}>
            {signIn.isPending && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
          <p className="text-center text-xs text-muted-foreground">Forgot your password? Ask your company admin to reset it.</p>
        </form>
      </main>
    </div>
  );
}
