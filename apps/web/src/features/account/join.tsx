/**
 * /join/:token (PLAN.md §21.1): "Join <company> on Kaampilot". Signed in: one Join button. Otherwise: sign up with
 * email / mobile → code → name + username + password (an existing account gives just its password), or "I already have an
 * account" (sign in, then back here). Then Home of that company.
 */
import { errorMessage, session, useClaims } from '@freefounders/core';
import {
  type AcceptAsNew,
  identifierKind,
  inviteRoleName,
  type OtpSent,
  suggestUsername,
  useAcceptInvite,
  useInvitePreview,
  useSignupStart,
  useSignupVerify,
  usernameErrorOf,
  useUsernameCheck,
} from '@freefounders/core/account';
import { APP_NAMES, PLATFORM_PASSWORD_MIN } from '@freefounders/core/admin';
import { Building2, Link2 } from '@/components/icons';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { AuthFrame, BackButton, CodeField, codeError, CodeWait, DevCodeNote, FormError, PasswordField, ResendCode, sentTo, StepProgress, StepTitle, TextField, useCodeTimer, UsernameField } from './parts';

type Step = 'choose' | 'identifier' | 'code' | 'profile';

export function JoinPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const claims = useClaims();
  const [checked, setChecked] = useState(() => session.signedIn());
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();
  const start = useSignupStart();
  const verify = useSignupVerify();
  const [step, setStep] = useState<Step>('choose');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState<(OtpSent & { for: string }) | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState<{ signupToken: string; accountExists: boolean } | null>(null);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const usernameTouched = useRef(false);
  const newAccount = step === 'profile' && !!verified && !verified.accountExists;
  const check = useUsernameCheck(username, newAccount);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const timer = useCodeTimer();

  // A free username from the name, until the person types their own (PLAN.md §21.5).
  useEffect(() => {
    if (!newAccount || usernameTouched.current || fullName.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => void suggestUsername(fullName).then((s) => live && s && !usernameTouched.current && setUsername(s)), 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [fullName, newAccount]);

  // A refresh cookie may still sign this browser in.
  useEffect(() => {
    if (session.signedIn()) return;
    void session.refresh().finally(() => setChecked(true));
  }, []);

  if (!checked || preview.isLoading) return <PageLoader />;

  const invite = preview.data;
  if (!invite || !invite.valid) {
    return (
      <AuthFrame>
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-card" role="alert">
          <Link2 className="size-8 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">
            {invite?.reason === 'expired' ? 'This invite link has expired' : invite?.reason === 'revoked' ? 'This invite link was switched off' : invite?.reason === 'used_up' ? 'This invite link is used up' : 'This invite link doesn’t work'}
          </h1>
          <p className="text-[15px] text-muted-foreground">
            {invite?.message ?? (preview.isError ? errorMessage(preview.error) : 'It has expired, was switched off, or has been used up. Ask the person who sent it for a new link.')}
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthFrame>
    );
  }

  const joined = async (asNew?: AcceptAsNew) => {
    try {
      await accept.mutateAsync({ token, asNew });
      navigate('/?home=1&welcome=1', { replace: true });
    } catch {
      /* shown below */
    }
  };

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

  const roles = invite.roles.map(inviteRoleName).filter(Boolean);
  const card = (
    <div className="mb-6 flex items-start gap-3 rounded-xl border bg-card p-4 shadow-card">
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden>
        <Building2 className="size-5" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="truncate text-base font-semibold">{invite.companyName}</p>
        {roles.length > 0 && <p className="text-muted-foreground">Role: {roles.join(', ')}</p>}
        {invite.apps.length > 0 && <p className="text-muted-foreground">Apps: {invite.apps.map((a) => (a === 'tasks' ? 'Attendance + Tasks' : APP_NAMES[a] ?? a)).join(', ')}</p>}
        {invite.expiresAt && <p className="text-xs text-muted-foreground">Link valid until {formatDate(invite.expiresAt)}</p>}
      </div>
    </div>
  );

  // A username taken at the last moment is shown on its field, not as a general error.
  const usernameError = accept.isError ? usernameErrorOf(accept.error) : null;
  const acceptError = accept.isError && !usernameError ? errorMessage(accept.error) : null;

  if (claims) {
    return (
      <AuthFrame>
        <StepTitle title={`Join ${invite.companyName} on Kaampilot`}>You’re signed in as {claims.name ?? 'yourself'}.</StepTitle>
        {card}
        <div className="space-y-3">
          <FormError>{acceptError}</FormError>
          <Button size="lg" className="h-11 w-full" loading={accept.isPending} onClick={() => void joined()}>
            Join {invite.companyName}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              void session.logout().then(() => setStep('choose'));
            }}
          >
            Not you? Sign out
          </Button>
        </div>
      </AuthFrame>
    );
  }

  const n = { choose: 1, identifier: 1, code: 2, profile: 3 }[step];
  return (
    <AuthFrame>
      {step !== 'choose' && <BackButton onClick={() => (setFieldError(null), setStep(step === 'identifier' ? 'choose' : step === 'code' ? 'identifier' : 'code'))} />}
      {step !== 'choose' && <StepProgress step={n} total={3} label="Join" />}

      {step === 'choose' && (
        <div>
          <StepTitle title={`Join ${invite.companyName} on Kaampilot`}>You’ve been invited to work together on Kaampilot.</StepTitle>
          {card}
          <div className="space-y-3">
            <Button size="lg" className="h-11 w-full" onClick={() => setStep('identifier')}>
              Create my account
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 w-full">
              <Link to={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>I already have an account</Link>
            </Button>
          </div>
        </div>
      )}

      {step === 'identifier' && (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!identifierKind(identifier)) return setFieldError('Enter your email or 10-digit mobile number.');
            setFieldError(null);
            if (otp && otp.for === identifier.trim()) return setStep(verified ? 'profile' : 'code');
            void send();
          }}
        >
          <StepTitle title="Your email or mobile">We’ll send a 6-digit code to check it’s you.</StepTitle>
          <TextField
            id="join-identifier"
            label="Email or mobile number"
            value={identifier}
            onChange={(e) => (setIdentifier(e.target.value), setFieldError(null), start.reset(), setOtp(null), setVerified(null))}
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
        </form>
      )}

      {step === 'code' && otp && (
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (code.length !== 6) return setFieldError('Enter the 6-digit code.');
            setFieldError(null);
            const res = await verify.mutateAsync({ otpId: otp.otpId, code }).catch(() => null);
            if (!res) return;
            setVerified(res);
            setPassword('');
            setStep('profile');
          }}
        >
          <StepTitle title="Check your code">{sentTo(otp.for, otp.channel)}</StepTitle>
          <DevCodeNote code={otp.devCode} />
          <CodeField value={code} onChange={(v) => (setCode(v), setFieldError(null), verify.reset())} error={fieldError} />
          <FormError>{codeError(verify.error, verify.isError) ?? codeError(start.error, start.isError)}</FormError>
          {verify.isError && /sign in with it/i.test(errorMessage(verify.error)) && (
            <Button asChild variant="outline" className="h-11 w-full">
              <Link to={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>Go to sign in</Link>
            </Button>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" loading={verify.isPending}>
            Continue
          </Button>
          <ResendCode onResend={() => void send()} busy={start.isPending} left={timer.left} />
        </form>
      )}

      {step === 'profile' && verified && (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!verified.accountExists && fullName.trim().length < 2) return setFieldError('name');
            if (!verified.accountExists && !check.ok) return document.getElementById('join-username')?.focus();
            if (password.length < (verified.accountExists ? 1 : PLATFORM_PASSWORD_MIN)) return setFieldError('password');
            setFieldError(null);
            void joined({ signupToken: verified.signupToken, fullName: fullName.trim(), password, ...(verified.accountExists ? {} : { username: username.trim() }) });
          }}
        >
          {verified.accountExists ? (
            <>
              <StepTitle title="Welcome back">{identifier.trim()} already has an account. Enter its password to join.</StepTitle>
              <PasswordField id="join-password" value={password} onChange={setPassword} newPassword={false} autoFocus error={fieldError === 'password' ? 'Enter your password.' : null} />
              <p className="text-sm">
                <Link to="/forgot" className="font-semibold text-primary hover:underline">
                  Forgot password?
                </Link>
              </p>
            </>
          ) : (
            <>
              <StepTitle title="About you">How your new team will see you.</StepTitle>
              <TextField id="join-name" label="Your full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" autoFocus error={fieldError === 'name' ? 'Enter your name.' : null} />
              <UsernameField
                id="join-username"
                value={username}
                onChange={(v) => {
                  usernameTouched.current = true;
                  setUsername(v);
                  if (accept.isError) accept.reset();
                }}
                check={check}
                serverError={usernameError}
              />
              <PasswordField
                id="join-password"
                label="Choose a password"
                value={password}
                onChange={setPassword}
                about={{ fullName, companyName: invite.companyName }}
                error={fieldError === 'password' ? `Use at least ${PLATFORM_PASSWORD_MIN} characters.` : null}
              />
            </>
          )}
          <FormError>{acceptError}</FormError>
          <Button type="submit" size="lg" className="h-11 w-full" loading={accept.isPending} disabled={!verified.accountExists && (!check.ok || !!usernameError)}>
            Join {invite.companyName}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
