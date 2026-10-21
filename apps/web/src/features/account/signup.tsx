/**
 * /signup (PLAN.md §20.5, §21.1): work email or mobile → 6-digit code → name + username + password (or, for an existing account,
 * just its password) → the company → "Setting up your company…" → Home with the Getting started checklist.
 * One question per screen, a progress bar and a back button; nothing typed is lost going back.
 */
import { ApiError, errorMessage } from '@freefounders/core';
import { companyNameErrorOf, type CompanyInput, identifierKind, type OtpSent, suggestUsername, useSignupComplete, useSignupStart, useSignupVerify, usernameErrorOf, useUsernameCheck } from '@freefounders/core/account';
import { PLATFORM_PASSWORD_MIN } from '@freefounders/core/admin';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CompanyForm, EMPTY_COMPANY, SetupScreen } from './company-form';
import { AuthFrame, BackButton, CodeField, codeError, CodeWait, DevCodeNote, FormError, PasswordField, ResendCode, sentTo, StepProgress, StepTitle, TextField, useCodeTimer, UsernameField } from './parts';

type Step = 'identifier' | 'code' | 'profile' | 'company' | 'setup';
const ORDER: Step[] = ['identifier', 'code', 'profile', 'company'];
const LABELS: Record<Step, string> = { identifier: 'Your email or mobile', code: 'Verify', profile: 'About you', company: 'Your company', setup: '' };

export function SignupPage() {
  const navigate = useNavigate();
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
    if (!identifierKind(identifier)) {
      setFieldError('Enter a work email (name@company.com) or a 10-digit mobile number.');
      return;
    }
    setFieldError(null);
    // Back from the code step with the same email / mobile: the code already sent still works.
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
      const res = await complete.mutateAsync({ signupToken: token!.signupToken, fullName: fullName.trim(), password, company: c, ...(token!.accountExists ? {} : { username: username.trim() }) });
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
    return <SetupScreen companyName={company.name} apps={company.apps} error={complete.isError ? errorMessage(complete.error) : null} onRetry={() => setStep(isPasswordError(complete.error) ? 'profile' : 'company')} />;
  }

  const n = ORDER.indexOf(step) + 1;
  return (
    <AuthFrame
      footer={
        <>
          Already using FreeFounders?{' '}
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
          <StepTitle title="Start free">Attendance, tasks and assets for your team. 14-day trial, no card.</StepTitle>
          <TextField
            id="signup-identifier"
            label="Work email or mobile number"
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
            error={fieldError}
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
          <StepTitle title="Check your code">{sentTo(otp.for, otp.channel)}</StepTitle>
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
              <StepTitle title="Welcome back">{identifier.trim()} already has a FreeFounders account. Enter its password to add a new company to it.</StepTitle>
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
            submitLabel="Create company"
            nameError={companyNameError}
          />
        </div>
      )}
    </AuthFrame>
  );
}

/** A wrong password for an existing account sends the person back to that step. */
function isPasswordError(err: unknown) {
  return /password/i.test(errorMessage(err));
}
