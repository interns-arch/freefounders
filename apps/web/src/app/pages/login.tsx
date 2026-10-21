import { ApiError, type ChooseCompany, errorMessage, session, useSignIn } from '@freefounders/core';
import { CheckCircle2, Eye, EyeOff, Package, ShieldCheck } from '@/components/icons';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ChooseCompanyCard } from '@/features/account/choose-company';
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
  // An account in several companies picks one (PLAN.md §21.2).
  const [choose, setChoose] = useState<ChooseCompany | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  // Said next to the field when Sign in is pressed with it empty (the button is never greyed out without a reason).
  const [missing, setMissing] = useState<{ login?: boolean; password?: boolean }>({});
  const [capsLock, setCapsLock] = useState(false);
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const next = safeNext(params.get('next'));

  // Already signed in (another tab, or the refresh cookie still works): go straight on.
  useEffect(() => {
    void session.refresh().then((ok) => ok && navigate(next ?? '/', { replace: true }));
  }, [navigate, next]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const gaps = { login: !login.trim(), password: !password };
    setMissing(gaps);
    if (gaps.login || gaps.password) {
      (gaps.login ? loginRef : passwordRef).current?.focus();
      return;
    }
    signIn.mutate(
      { login: login.trim(), password },
      {
        onSuccess: (res) => {
          if (res && res.chooseCompany.length) setChoose(res);
          else navigate(next ?? '/', { replace: true });
        },
      },
    );
  };
  const watchCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Desktop only: a flat trust-blue panel (deep navy in dark mode). Phones get just the form. */}
      <aside className="hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12 dark:border-r dark:border-border dark:bg-card dark:text-card-foreground" aria-hidden>
        <Logo onPrimary />
        <div className="max-w-md space-y-7">
          <span className="inline-flex items-center gap-2 rounded-sm border border-primary-foreground/35 px-3 py-1 font-mono text-[11px] font-semibold tracking-widest uppercase dark:border-primary/35 dark:text-primary">
            One sign-in · every app
          </span>
          <p className="text-[2.6rem] leading-[1.1] font-extrabold tracking-tight dark:text-foreground">Run your whole team from one place.</p>
          <ul className="space-y-3">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-[15px] font-medium">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-foreground/12 dark:bg-primary/12 dark:text-primary">
                  <p.icon className="size-[18px]" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm">FreeFounders</p>
      </aside>
      <main id="content" className="flex items-center justify-center bg-background p-4 sm:p-6">
        <div className="w-full max-w-[400px]">
          <div className="mb-5 flex justify-center lg:hidden">
            <Logo />
          </div>
          {choose ? (
            <ChooseCompanyCard choose={choose} onDone={() => navigate(next ?? '/', { replace: true })} onBack={() => setChoose(null)} />
          ) : (
          <form onSubmit={submit} noValidate className="space-y-5 rounded-xl border bg-card p-5 shadow-card sm:p-7" aria-labelledby="signin-title">
            <h1 id="signin-title" className="text-2xl font-bold tracking-tight">
              Sign in
            </h1>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login">Email, mobile, username or employee ID</Label>
                <Input
                  id="login"
                  ref={loginRef}
                  className="h-11"
                  value={login}
                  onChange={(e) => {
                    setLogin(e.target.value);
                    if (missing.login) setMissing((m) => ({ ...m, login: false }));
                  }}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  required
                  aria-invalid={missing.login || undefined}
                  aria-describedby={missing.login ? 'login-error' : undefined}
                />
                {missing.login && (
                  <p id="login-error" role="alert" className="text-[13px] font-medium text-destructive">
                    Enter your email, mobile number, username or employee ID.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    ref={passwordRef}
                    className="h-11 pr-20"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (missing.password) setMissing((m) => ({ ...m, password: false }));
                    }}
                    onKeyDown={watchCaps}
                    onKeyUp={watchCaps}
                    onBlur={() => setCapsLock(false)}
                    autoComplete="current-password"
                    required
                    aria-invalid={missing.password || undefined}
                    aria-describedby={[missing.password ? 'password-error' : '', capsLock ? 'caps-note' : ''].filter(Boolean).join(' ') || undefined}
                  />
                  {/* Named "Show" / "Hide" (not "Show password"): the label "Password" must point at the field alone. */}
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-pressed={show}
                    className="absolute top-1/2 right-1 flex h-9 min-w-16 -translate-y-1/2 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-[13px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
                {missing.password && (
                  <p id="password-error" role="alert" className="text-[13px] font-medium text-destructive">
                    Enter your password.
                  </p>
                )}
                {capsLock && (
                  <p id="caps-note" className="text-[13px] font-medium text-warning">
                    Caps Lock is on.
                  </p>
                )}
              </div>
            </div>
            {signIn.isError && (
              <div role="alert" className="space-y-1 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                <p>{errorMessage(signIn.error)}</p>
                {signIn.error instanceof ApiError && signIn.error.status === 401 && (
                  <p className="text-foreground">Signed up yourself? Use the email, mobile number or username you chose.</p>
                )}
              </div>
            )}
            <Button type="submit" className="h-11 w-full" size="lg" loading={signIn.isPending}>
              Sign in
            </Button>
            <p className="text-center text-sm">
              <Link to="/forgot" className="font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </p>
          </form>
          )}
          <p className="mt-5 text-center text-sm text-muted-foreground">
            New to FreeFounders?{' '}
            <Link to="/signup" className="font-semibold text-primary hover:underline">
              Start free
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">Signed in with a username or employee ID? Your company admin resets those passwords.</p>
        </div>
      </main>
    </div>
  );
}
