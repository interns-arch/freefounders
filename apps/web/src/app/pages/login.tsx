import { errorMessage, session, useSignIn } from '@freefounders/core';
import { CheckCircle2, Eye, EyeOff, Loader2, Package, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Logo } from '../shell-parts';
import { safeNext } from '../session-guard';

const POINTS = [
  { icon: ShieldCheck, text: 'Attendance and leave' },
  { icon: CheckCircle2, text: 'Tasks, checklists and approvals' },
  { icon: Package, text: 'Assets, joiners and exits' },
];

/** Sign in (PLAN.md §19.14): one short form, the login field focused, a show-password button; then straight to Home (or ?next=). */
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
      {/* Desktop only: the forest-green panel with two soft glows. Phones get just the form. */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12" aria-hidden>
        <div className="pointer-events-none absolute -top-40 -left-32 size-[36rem] rounded-full bg-brand-2/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-32 -bottom-40 size-[32rem] rounded-full bg-primary/35 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/25" />
        <div className="relative">
          <Logo onDark />
        </div>
        <div className="relative max-w-md space-y-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1 font-mono text-[11px] tracking-widest text-brand-2 uppercase">
            <span className="size-1.5 rounded-full bg-brand-2" />
            One sign-in · every app
          </span>
          <p className="text-[2.6rem] leading-[1.08] font-extrabold tracking-tight text-white">Run your whole team from one place.</p>
          <ul className="space-y-3">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-[15px] text-sidebar-foreground">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-brand-2 ring-1 ring-white/10">
                  <p.icon className="size-[18px]" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-sidebar-foreground/60">FreeFounders</p>
      </aside>
      <main id="content" className="flex items-center justify-center bg-background p-4 sm:p-6">
        <div className="w-full max-w-[400px]">
          <div className="mb-5 flex justify-center lg:hidden">
            <Logo />
          </div>
          <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-5 shadow-card-lg sm:p-7" aria-labelledby="signin-title">
            <h1 id="signin-title" className="text-2xl font-bold tracking-tight">
              Sign in
            </h1>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login">Email, username or employee ID</Label>
                <Input id="login" className="h-11" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" className="h-11 pr-20" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                  {/* Named "Show" / "Hide" (not "Show password"): the label "Password" must point at the field alone. */}
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-pressed={show}
                    className="absolute top-1/2 right-1 flex h-9 -translate-y-1/2 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
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
          <p className="mt-4 text-center text-xs text-muted-foreground">Forgot your password? Ask your company admin to reset it.</p>
        </div>
      </main>
    </div>
  );
}
