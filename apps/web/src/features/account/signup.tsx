/**
 * /signup (PLAN.md §20.5, §21.1): work email → 6-digit code → name + username + password (or, for an existing account,
 * just its password) → the company → "Setting up your company…" → Home with the Getting started checklist.
 * One question per screen, a progress bar and a back button; nothing typed is lost going back.
 * "Buy now" (PLAN.md §24.4, `/signup?buy=…` from the landing calculator / pricing page): the same steps, then the last
 * one shows the plan and says "Continue to payment": the company is made waiting for its payment and the payment page
 * opens at once (no trial). Not paid → the app shows "Finish payment" (Pay again or the free trial instead).
 */
import { ApiError, errorMessage, parseBuyNow, type PriceChoice, quotePrice, usePublicPricing } from '@kaampilot/core';
import { companyNameErrorOf, type CompanyInput, identifierKind, MOBILE_SIGN_IN_OFF, type OtpSent, suggestUsername, useSignupComplete, useSignupStart, useSignupVerify, usernameErrorOf, useUsernameCheck } from '@kaampilot/core/account';
import { PLATFORM_PASSWORD_MIN } from '@kaampilot/core/admin';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CompanyForm, EMPTY_COMPANY, SetupScreen } from './company-form';
import { AuthFrame, BackButton, CodeField, channelOff, codeError, CodeWait, DevCodeNote, FormError, PasswordField, ResendCode, sentTo, StepProgress, StepTitle, TextField, useCodeTimer, UsernameField } from './parts';

type Step = 'identifier' | 'code' | 'profile' | 'company' | 'setup';
const ORDER: Step[] = ['identifier', 'code', 'profile', 'company'];
const LABELS: Record<Step, string> = { identifier: 'Your email', code: 'Verify', profile: 'About you', company: 'Your company', setup: '' };

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // "Buy now": the plan chosen on the landing page (null: the usual free trial).
  const buy = useMemo(() => parseBuyNow(params), [params]);
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState<(OtpSent & { for: string }) | null>(null);
  const [code, setCode] = useState('');
  const [token, setToken] = useState<{ signupToken: string; accountExists: boolean } | null>(null);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  // Typed by the person: the suggestion from the name no longer replaces it.
  const usernameTouched = useRef(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyInput>(EMPTY_COMPANY);
  /** 409 at submit: another company took this name a moment ago (PLAN.md §21.6). */
  const [companyNameError, setCompanyNameError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const start = useSignupStart();
  const verify = useSignupVerify();
  const complete = useSignupComplete();
  const timer = useCodeTimer();
  const newAccount = step === 'profile' && !!token && !token.accountExists;
  const check = useUsernameCheck(username, newAccount);

  // A free username from the name ("Asha Rao" → asha.rao), until the person types their own.
  useEffect(() => {
    if (!newAccount || usernameTouched.current || fullName.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void suggestUsername(fullName).then((s) => {
        if (live && s && !usernameTouched.current) setUsername(s);
      });
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fullName, newAccount]);

  const back = () => {
    setFieldError(null);
    setStep(ORDER[Math.max(0, ORDER.indexOf(step) - 1)]);
  };

  const sendCode = async () => {
    try {
      const res = await start.mutateAsync(identifier.trim());
      timer.sent();
      setOtp({ ...res, for: identifier.trim() });
      setCode('');
      verify.reset();
      setStep('code');
    } catch (err) {
      timer.throttled(err);
    }
  };

  const submitIdentifier = (e: FormEvent) => {
    e.preventDefault();
    const kind = identifierKind(identifier);
    if (kind !== 'email') {
      setFieldError(kind === 'mobile' ? MOBILE_SIGN_IN_OFF : 'Enter a work email (name@company.com).');
      return;
    }
    setFieldError(null);
    // Back from the code step with the same email: the code already sent still works.
    if (otp && otp.for === identifier.trim() && !token) return setStep('code');
    if (token && otp?.for === identifier.trim()) return setStep('profile');
    void sendCode();
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setFieldError('Enter the 6-digit code.');
      return;
    }
    setFieldError(null);
    const res = await verify.mutateAsync({ otpId: otp!.otpId, code }).catch(() => null);
    if (!res) return;
    setToken(res);
    setPassword('');
    setStep('profile');
  };

  const submitProfile = (e: FormEvent) => {
    e.preventDefault();
    if (!token?.accountExists && fullName.trim().length < 2) {
      setFieldError('name');
      document.getElementById('signup-name')?.focus();
      return;
    }
    if (!token?.accountExists && !check.ok) {
      document.getElementById('signup-username')?.focus();
      return;
    }
    if (password.length < (token?.accountExists ? 1 : PLATFORM_PASSWORD_MIN)) {
      setFieldError('password');
      document.getElementById('signup-password')?.focus();
      return;
    }
    setFieldError(null);
    setStep('company');
  };

  const create = async (c: CompanyInput) => {
    setCompany(c);
    setStep('setup');
    complete.reset();
    try {
      const res = await complete.mutateAsync({
        signupToken: token!.signupToken,
        fullName: fullName.trim(),
        password,
        company: buy ? { ...c, apps: appsOfChoice(buy) } : c,
        ...(token!.accountExists ? {} : { username: username.trim() }),
        ...(buy ? { buy: { plan: buy.complete ? 'complete' : 'modules', ...(buy.complete ? {} : { modules: buy.modules }), ai: buy.ai, seats: buy.users } } : {}),
      });
      if (res.pendingPayment) {
        // Straight to the payment page; without one (it could not start), the app shows "Finish payment".
        if (res.checkout?.checkoutUrl) return navigate(res.checkout.checkoutUrl, { replace: true });
        if (res.checkoutError) toast.error(res.checkoutError, { duration: 10_000 });
        return navigate('/?home=1', { replace: true });
      }
      if (res.setupIncomplete) {
        toast.warning('Your company is created, but part of the app set-up has not finished. It finishes by itself in a few minutes; if an app does not open, sign out and in again later.', { duration: 15_000 });
      }
      navigate('/?home=1&welcome=1', { replace: true });
    } catch (err) {
      // Someone took the username a moment ago: back to that field with the message (nothing was created).
      const taken = usernameErrorOf(err);
      if (taken) {
        setUsernameError(taken);
        setStep('profile');
        return;
      }
      // Same for the company name: back to the company step with the message on the field.
      const nameTaken = companyNameErrorOf(err);
      if (nameTaken) {
        setCompanyNameError(nameTaken);
        setStep('company');
      }
      /* anything else is shown on the setup screen */
    }
  };

  if (step === 'setup') {
    return (
      <SetupScreen
        companyName={company.name}
        apps={company.apps}
        steps={buy ? ['Creating your company', 'Opening the payment page'] : undefined}
        error={complete.isError ? errorMessage(complete.error) : null}
        onRetry={() => setStep(isPasswordError(complete.error) ? 'profile' : 'company')}
      />
    );
  }

  const n = ORDER.indexOf(step) + 1;
  return (
    <AuthFrame
      footer={
        <>
          Already using Kaampilot?{' '}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {step !== 'identifier' && <BackButton onClick={back} />}
      <StepProgress step={n} total={ORDER.length} label={LABELS[step]} />

      {step === 'identifier' && (
        <form onSubmit={submitIdentifier} noValidate className="space-y-4">
          {buy ? (
            <StepTitle title="Buy Kaampilot">Create your account and company, then pay for your plan. No trial needed.</StepTitle>
          ) : (
            <StepTitle title="Start free">Attendance, tasks and assets for your team. Free trial, no card.</StepTitle>
          )}
          <TextField
            id="signup-identifier"
            label="Work email"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              if (fieldError) setFieldError(null);
              start.reset();
            }}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            error={fieldError ?? channelOff(start.error, start.isError)}
          />
          {start.isError && <CodeWait left={timer.left} />}
          <FormError>{codeError(start.error, start.isError)}</FormError>
          <Button type="submit" size="lg" className="h-11 w-full" loading={start.isPending}>
            Continue
          </Button>
          <p className="text-center text-xs text-muted-foreground">We’ll send you a 6-digit code to check it’s you.</p>
        </form>
      )}

      {step === 'code' && otp && (
        <form onSubmit={submitCode} noValidate className="space-y-4">
          <StepTitle title="Check your code">{sentTo(otp.for)}</StepTitle>
          <DevCodeNote code={otp.devCode} />
          <CodeField value={code} onChange={(v) => (setCode(v), setFieldError(null), verify.reset())} error={fieldError} />
          <FormError>{codeError(verify.error, verify.isError) ?? codeError(start.error, start.isError)}</FormError>
          {verify.error instanceof ApiError && verify.error.status === 409 && (
            <Button asChild variant="outline" className="h-11 w-full">
              <Link to="/login">Go to sign in</Link>
            </Button>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" loading={verify.isPending}>
            Continue
          </Button>
          <ResendCode onResend={() => void sendCode()} busy={start.isPending} left={timer.left} />
        </form>
      )}

      {step === 'profile' && token && (
        <form onSubmit={submitProfile} noValidate className="space-y-4">
          {token.accountExists ? (
            <>
              <StepTitle title="Welcome back">{identifier.trim()} already has a Kaampilot account. Enter its password to add a new company to it.</StepTitle>
              <PasswordField id="signup-password" value={password} onChange={setPassword} newPassword={false} autoFocus error={fieldError === 'password' ? 'Enter your password.' : null} />
              <p className="text-sm">
                <Link to="/forgot" className="font-semibold text-primary hover:underline">
                  Forgot password?
                </Link>
              </p>
            </>
          ) : (
            <>
              <StepTitle title="About you">This is how your team will see you.</StepTitle>
              <TextField
                id="signup-name"
                label="Your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                autoFocus
                error={fieldError === 'name' ? 'Enter your name.' : null}
              />
              <UsernameField
                id="signup-username"
                value={username}
                onChange={(v) => {
                  usernameTouched.current = true;
                  setUsername(v);
                  setUsernameError(null);
                }}
                check={check}
                serverError={usernameError}
              />
              <PasswordField
                id="signup-password"
                label="Choose a password"
                value={password}
                onChange={setPassword}
                about={{ fullName, email: identifierKind(identifier) === 'email' ? identifier : null }}
                error={fieldError === 'password' ? `Use at least ${PLATFORM_PASSWORD_MIN} characters.` : null}
              />
            </>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" disabled={!token.accountExists && (!check.ok || !!usernameError)}>
            Continue
          </Button>
        </form>
      )}

      {step === 'company' && (
        <div>
          <StepTitle title="Create your company">You can change all of this later in Settings.</StepTitle>
          <CompanyForm
            value={company}
            onChange={(c) => {
              if (c.name !== company.name) setCompanyNameError(null);
              setCompany(c);
            }}
            onSubmit={(c) => void create(c)}
            submitLabel={buy ? 'Continue to payment' : 'Create company'}
            nameError={companyNameError}
            hideApps={!!buy}
            summary={buy ? <BuySummary choice={buy} /> : undefined}
            footnote={buy ? 'You pay on the next screen (UPI, card or net banking). Your plan starts as soon as it is paid.' : undefined}
          />
          {buy && (
            <p className="mt-3 text-center text-sm">
              <Link to="/signup" replace className="font-semibold text-primary hover:underline">
                Start the free trial instead
              </Link>
            </p>
          )}
        </div>
      )}
    </AuthFrame>
  );
}

/** A wrong password for an existing account sends the person back to that step. */
function isPasswordError(err: unknown) {
  return /password/i.test(errorMessage(err));
}

/** The apps a "Buy now" plan opens (Tasks and Attendance live in the Tasks app). */
function appsOfChoice(c: PriceChoice): Array<'tasks' | 'assets'> {
  if (c.complete) return ['tasks', 'assets'];
  const apps: Array<'tasks' | 'assets'> = [];
  if (c.modules.includes('tasks') || c.modules.includes('attendance')) apps.push('tasks');
  if (c.modules.includes('assets')) apps.push('assets');
  return apps;
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** "Buy now": the plan, users and the monthly total with GST (the payment page shows the exact GST split). */
function BuySummary({ choice }: { choice: PriceChoice }) {
  const { pricing } = usePublicPricing();
  const q = quotePrice(pricing, choice);
  const names = choice.complete ? 'Complete' : pricing.modules.filter((m) => choice.modules.includes(m.key)).map((m) => m.name).join(' + ');
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm" aria-labelledby="buy-summary-title" role="region" data-testid="buy-summary">
      <p id="buy-summary-title" className="font-semibold">
        Your plan: {names}
        {choice.ai ? ' with AI' : ''}
      </p>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            {choice.users} {choice.users === 1 ? 'user' : 'users'} × {rupees(q.perUser)}
          </dt>
          <dd className="tabular-nums">{rupees(q.monthly)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">GST {pricing.gstPercent}%</dt>
          <dd className="tabular-nums">{rupees(q.gst)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t pt-1 font-semibold">
          <dt>Total per month</dt>
          <dd className="tabular-nums">{rupees(q.total)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        <Link to="/pricing" className="font-semibold text-primary hover:underline">
          Change the plan
        </Link>
      </p>
    </div>
  );
}
