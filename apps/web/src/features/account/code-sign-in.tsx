/**
 * Sign in with a code instead of a password (PLAN.md §21.8), on /login?code=1: the email or mobile number of an account
 * → a 6-digit code (SMS / email, 10 minutes, 5 tries) → signed in, or the choice of company for an account in several.
 * Usernames and employee IDs (admin-made logins) have nowhere to send a code: they sign in with their password.
 */
import { type ChooseCompany } from '@freefounders/core';
import { identifierKind, type OtpSent, useLoginCodeStart, useLoginWithCode } from '@freefounders/core/account';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BackButton, CodeField, channelOff, codeError, CodeWait, DevCodeNote, FormError, ResendCode, sentTo, StepTitle, TextField, useCodeTimer } from './parts';

export function CodeSignIn({ initial = '', onSignedIn, passwordLink }: { initial?: string; onSignedIn: (choose?: ChooseCompany) => void; passwordLink: ReactNode }) {
  const [step, setStep] = useState<'identifier' | 'code'>('identifier');
  // A username typed on the password form is not carried over (it cannot get a code).
  const [identifier, setIdentifier] = useState(identifierKind(initial) ? initial.trim() : '');
  const [otp, setOtp] = useState<(OtpSent & { for: string }) | null>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const start = useLoginCodeStart();
  const verify = useLoginWithCode();
  const timer = useCodeTimer();

  const send = async () => {
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
      return setFieldError(
        identifier.includes('@') || /^[+\d\s()-]+$/.test(identifier.trim())
          ? 'Enter a valid email, or a 10-digit mobile number.'
          : 'Codes go to the email or mobile number of your Kaampilot account. With a username or employee ID, sign in with your password.',
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
    const res = await verify.mutateAsync({ otpId: otp!.otpId, code }).catch(() => null);
    if (res === null) return;
    onSignedIn(res && res.chooseCompany.length ? res : undefined);
  };

  const card = 'space-y-5 rounded-xl border bg-card p-5 shadow-card sm:p-7';
  if (step === 'code' && otp) {
    return (
      <form onSubmit={(e) => void submitCode(e)} noValidate className={card} aria-label="Sign in with a code">
        <BackButton onClick={() => (setFieldError(null), setStep('identifier'))} />
        <StepTitle title="Enter your code">{sentTo(otp.for, otp.channel)}</StepTitle>
        <DevCodeNote code={otp.devCode} />
        <CodeField value={code} onChange={(v) => (setCode(v), setFieldError(null), verify.reset())} error={fieldError} />
        <FormError>{codeError(verify.error, verify.isError) ?? codeError(start.error, start.isError)}</FormError>
        <Button type="submit" size="lg" className="h-11 w-full" loading={verify.isPending}>
          Sign in
        </Button>
        <ResendCode onResend={() => void send()} busy={start.isPending} left={timer.left} />
      </form>
    );
  }

  return (
    <form onSubmit={submitIdentifier} noValidate className={card} aria-label="Sign in with a code">
      <StepTitle title="Sign in with a code">We’ll send a 6-digit code to the email or mobile number of your account.</StepTitle>
      <TextField
        id="code-identifier"
        label="Email or mobile number"
        value={identifier}
        onChange={(e) => (setIdentifier(e.target.value), setFieldError(null), start.reset())}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
        error={fieldError ?? channelOff(start.error, start.isError)}
      />
      {start.isError && <CodeWait left={timer.left} />}
      <FormError>{codeError(start.error, start.isError)}</FormError>
      <Button type="submit" size="lg" className="h-11 w-full" loading={start.isPending}>
        Send code
      </Button>
      <p className="text-center text-sm">{passwordLink}</p>
    </form>
  );
}
