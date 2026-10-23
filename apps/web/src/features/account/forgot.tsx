/**
 * /forgot (PLAN.md §21.1): email or mobile → code (checked on its own step) → new password → signed in (or the choice
 * of company for an account in several). For accounts; admin-made logins (username / employee ID) ask their admin.
 */
import { type ChooseCompany, errorMessage, session } from '@freefounders/core';
import { identifierKind, type OtpSent, useForgotPassword, useResetPassword, useResetVerify } from '@freefounders/core/account';
import { PLATFORM_PASSWORD_MIN } from '@freefounders/core/admin';
import { CheckCircle2, Loader2 } from '@/components/icons';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ChooseCompanyCard } from './choose-company';
import { AuthFrame, BackButton, CodeField, codeError, CodeWait, DevCodeNote, FormError, PasswordField, ResendCode, sentTo, StepProgress, StepTitle, TextField, useCodeTimer } from './parts';

type Step = 'identifier' | 'code' | 'password' | 'signing-in' | 'choose' | 'done';

export function ForgotPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState<(OtpSent & { for: string }) | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [choose, setChoose] = useState<ChooseCompany | null>(null);
  const forgot = useForgotPassword();
  const check = useResetVerify();
  const reset = useResetPassword();
  const timer = useCodeTimer();

  const send = async () => {
    try {
      const res = await forgot.mutateAsync(identifier.trim());
      timer.sent();
      setOtp({ ...res, for: identifier.trim() });
      setCode('');
      check.reset();
      setStep('code');
    } catch (err) {
      timer.throttled(err);
    }
  };

  const submitIdentifier = (e: FormEvent) => {
    e.preventDefault();
    if (!identifierKind(identifier)) {
      return setFieldError(
        identifier.includes('@') || /^[+\d\s()-]+$/.test(identifier.trim())
          ? 'Enter a valid email, or a 10-digit mobile number.'
          : 'Enter the email or mobile number of your Kaampilot account. A username or employee ID is reset by your company admin.',
      );
    }
    setFieldError(null);
    // Back from the code step with the same email / mobile: the code already sent still works.
    if (otp && otp.for === identifier.trim()) return setStep('code');
    void send();
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return setFieldError('Enter the 6-digit code.');
    setFieldError(null);
    const ok = await check.mutateAsync({ otpId: otp!.otpId, code }).catch(() => null);
    if (!ok) return;
    reset.reset();
    setStep('password');
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PLATFORM_PASSWORD_MIN) return setFieldError(`Use at least ${PLATFORM_PASSWORD_MIN} characters.`);
    setFieldError(null);
    const ok = await reset.mutateAsync({ otpId: otp!.otpId, code, newPassword: password }).catch(() => null);
    if (ok === null) return;
    // Signed in straight away with the new password; if that fails, a plain "Sign in" button.
    setStep('signing-in');
    try {
      const res = await session.login(otp!.for, password);
      if (res && res.chooseCompany.length) {
        setChoose(res);
        setStep('choose');
      } else navigate('/', { replace: true });
    } catch {
      setStep('done');
    }
  };

  if (step === 'choose' && choose) {
    return (
      <AuthFrame>
        <p className="mb-4 flex items-center gap-2 text-sm font-medium text-success" role="status">
          <CheckCircle2 className="size-4" aria-hidden /> Password changed.
        </p>
        <ChooseCompanyCard choose={choose} onDone={() => navigate('/', { replace: true })} onBack={() => setStep('done')} />
      </AuthFrame>
    );
  }

  // A code the server refused because it was used or tried too often: the next step is a new code.
  const codeErr = codeError(check.error, check.isError) ?? codeError(forgot.error, forgot.isError);
  const n = { identifier: 1, code: 2, password: 3, 'signing-in': 3, choose: 3, done: 3 }[step];
  return (
    <AuthFrame
      footer={
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {step === 'code' && <BackButton onClick={() => (setFieldError(null), setStep('identifier'))} />}
      {step === 'password' && <BackButton onClick={() => (setFieldError(null), setStep('code'))} />}
      {(step === 'identifier' || step === 'code' || step === 'password') && <StepProgress step={n} total={3} label="Reset password" />}

      {step === 'identifier' && (
        <form onSubmit={submitIdentifier} noValidate className="space-y-4">
          <StepTitle title="Forgot your password?">We’ll send a code to the email or mobile number of your account.</StepTitle>
          <TextField
            id="forgot-identifier"
            label="Email or mobile number"
            value={identifier}
            onChange={(e) => (setIdentifier(e.target.value), setFieldError(null), forgot.reset())}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            error={fieldError}
          />
          {forgot.isError && <CodeWait left={timer.left} />}
          <FormError>{codeError(forgot.error, forgot.isError)}</FormError>
          <Button type="submit" size="lg" className="h-11 w-full" loading={forgot.isPending}>
            Send code
          </Button>
          <p className="text-center text-xs text-muted-foreground">Signed in with a username or employee ID? Ask your company admin to reset it.</p>
        </form>
      )}

      {step === 'code' && otp && (
        <form onSubmit={(e) => void submitCode(e)} noValidate className="space-y-4">
          <StepTitle title="Check your code">{sentTo(otp.for, otp.channel)}</StepTitle>
          <DevCodeNote code={otp.devCode} />
          <CodeField value={code} onChange={(v) => (setCode(v), setFieldError(null), check.reset())} error={fieldError} />
          <FormError>{codeErr}</FormError>
          <Button type="submit" size="lg" className="h-11 w-full" loading={check.isPending}>
            Continue
          </Button>
          <ResendCode onResend={() => void send()} busy={forgot.isPending} left={timer.left} />
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => void submitPassword(e)} noValidate className="space-y-4">
          <StepTitle title="Choose a new password">You’ll be signed out on your other devices.</StepTitle>
          <PasswordField id="forgot-password" label="New password" value={password} onChange={(v) => (setPassword(v), setFieldError(null))} autoFocus error={fieldError} />
          <FormError>{reset.isError ? errorMessage(reset.error) : null}</FormError>
          {reset.isError && /code/i.test(errorMessage(reset.error)) && (
            <Button type="button" variant="outline" className="w-full" onClick={() => (setStep('identifier'), setOtp(null), reset.reset())}>
              Ask for a new code
            </Button>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" loading={reset.isPending}>
            Save password
          </Button>
        </form>
      )}

      {step === 'signing-in' && (
        <div className="space-y-4 text-center" role="status" aria-live="polite">
          <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
          <StepTitle title="Password changed">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Signing you in…
            </span>
          </StepTitle>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-5 text-center" role="status">
          <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
          <StepTitle title="Password changed">Sign in with your new password.</StepTitle>
          <Button asChild size="lg" className="h-11 w-full">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      )}
    </AuthFrame>
  );
}
