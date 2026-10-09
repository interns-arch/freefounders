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
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* The old login's forest-green panel: deep green with two soft radial glows. */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 size-[36rem] rounded-full bg-brand-2/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-32 -bottom-40 size-[32rem] rounded-full bg-primary/35 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/25" />
        <div className="relative">
          <Logo onDark />
        </div>
        <div className="relative max-w-md space-y-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1 font-mono text-[11px] tracking-widest text-brand-2 uppercase">
            <span className="size-1.5 rounded-full bg-brand-2" aria-hidden />
            One sign-in · every app
          </span>
          <h1 className="text-[2.6rem] leading-[1.08] font-extrabold tracking-tight text-white">Run your whole team from one place.</h1>
          <ul className="space-y-3">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-[15px] text-sidebar-foreground">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-brand-2 ring-1 ring-white/10" aria-hidden>
                  <p.icon className="size-[18px]" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-sidebar-foreground/60">One sign-in for every FreeFounders app.</p>
      </aside>
      <main className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 flex justify-center lg:hidden">
            <Logo />
          </div>
          <form onSubmit={submit} className="space-y-6 rounded-xl border bg-card p-7 shadow-card-lg" aria-labelledby="signin-title">
            <div className="space-y-1.5">
              <h1 id="signin-title" className="text-2xl font-bold tracking-tight">
                Sign in
              </h1>
              <p className="text-sm text-muted-foreground">One login for Tasks and Assets.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login">Email, username or employee ID</Label>
                <Input id="login" className="h-10" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" className="h-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
            </div>
            {signIn.isError && (
              <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {errorMessage(signIn.error)}
              </p>
            )}
            <Button type="submit" className="h-11 w-full" size="lg" disabled={signIn.isPending || !login || !password}>
              {signIn.isPending && <Loader2 className="size-4 animate-spin" />}
              Sign in
            </Button>
          </form>
          <p className="mt-5 text-center text-xs text-muted-foreground">Forgot your password? Ask your company admin to reset it.</p>
        </div>
      </main>
    </div>
  );
}
