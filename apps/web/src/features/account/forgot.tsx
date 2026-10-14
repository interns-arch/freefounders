/** /forgot (PLAN.md §21.1): email or mobile → code → new password → back to sign-in. For accounts (admin-made logins ask their admin). */
import { errorMessage } from '@freefounders/core';
import { identifierKind, type OtpSent, useForgotPassword, useResetPassword } from '@freefounders/core/account';
import { PLATFORM_PASSWORD_MIN } from '@freefounders/core/admin';
import { CheckCircle2 } from '@/components/icons';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { AuthFrame, BackButton, CodeField, DevCodeNote, FormError, PasswordField, ResendCode, sentTo, StepProgress, StepTitle, TextField } from './parts';

type Step = 'identifier' | 'code' | 'password' | 'done';

export function ForgotPage() {
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState<OtpSent | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const forgot = useForgotPassword();
  const reset = useResetPassword();

  const send = async () => {
    const res = await forgot.mutateAsync(identifier.trim()).catch(() => null);
    if (!res) return;
    setOtp(res);
    setCode('');
    setStep('code');
  };

  const submitIdentifier = (e: FormEvent) => {
    e.preventDefault();
    if (!identifierKind(identifier)) return setFieldError('Enter the email or mobile number of your FreeFounders account.');
    setFieldError(null);
    void send();
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return setFieldError('Enter the 6-digit code.');
    setFieldError(null);
    reset.reset();
    setStep('password');
  };
  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < PLATFORM_PASSWORD_MIN) return setFieldError(`Use at least ${PLATFORM_PASSWORD_MIN} characters.`);
    setFieldError(null);
    const ok = await reset.mutateAsync({ otpId: otp!.otpId, code, newPassword: password }).catch(() => null);
    if (ok !== null) setStep('done');
  };

  const n = { identifier: 1, code: 2, password: 3, done: 3 }[step];
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
      {step !== 'done' && <StepProgress step={n} total={3} label="Reset password" />}

      {step === 'identifier' && (
        <form onSubmit={submitIdentifier} noValidate className="space-y-4">
          <StepTitle title="Forgot your password?">We’ll send a code to the email or mobile number of your account.</StepTitle>
          <TextField
            id="forgot-identifier"
            label="Email or mobile number"
            value={identifier}
            onChange={(e) => (setIdentifier(e.target.value), setFieldError(null))}
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            error={fieldError}
          />
          <FormError>{forgot.isError ? errorMessage(forgot.error) : null}</FormError>
          <Button type="submit" size="lg" className="h-11 w-full" loading={forgot.isPending}>
            Send code
          </Button>
          <p className="text-center text-xs text-muted-foreground">Signed in with a username or employee ID? Ask your company admin to reset it.</p>
        </form>
      )}

      {step === 'code' && otp && (
        <form onSubmit={submitCode} noValidate className="space-y-4">
          <StepTitle title="Check your code">{sentTo(identifier.trim(), otp.channel)}</StepTitle>
          <DevCodeNote code={otp.devCode} />
          <CodeField value={code} onChange={(v) => (setCode(v), setFieldError(null))} error={fieldError} />
          <Button type="submit" size="lg" className="h-11 w-full">
            Continue
          </Button>
          <ResendCode onResend={() => void send()} busy={forgot.isPending} resetKey={otp.otpId} />
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => void submitPassword(e)} noValidate className="space-y-4">
          <StepTitle title="Choose a new password">You’ll be signed out on your other devices.</StepTitle>
          <PasswordField id="forgot-password" label="New password" value={password} onChange={(v) => (setPassword(v), setFieldError(null))} autoFocus error={fieldError} />
          <FormError>{reset.isError ? errorMessage(reset.error) : null}</FormError>
          <Button type="submit" size="lg" className="h-11 w-full" loading={reset.isPending}>
            Save password
          </Button>
        </form>
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
