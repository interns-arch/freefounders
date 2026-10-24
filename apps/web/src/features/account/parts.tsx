/**
 * Pieces of the public account pages (sign-up, join, forgot password, new company; PLAN.md §20.5, §21): a calm centred
 * frame like Notion's, one question per screen, a progress bar, a back button, the one-time-code field and its
 * "Test mode" note.
 */
import { ApiError, errorMessage, retryAfterSeconds } from '@freefounders/core';
import { type PasswordAbout, PLATFORM_PASSWORD_MIN } from '@freefounders/core/admin';
import { type CompanyNameCheckState, type UsernameCheckState } from '@freefounders/core/account';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Info } from '@/components/icons';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LiveCheckLine } from '@/components/common/live-check';
import { WeakPasswordNote } from '@/components/common/weak-password-note';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BrandLockup } from '@/components/brand';

/** The page around a public step: logo, one card, a quiet footer. Phones: full width with 16 px gutters, no sideways scroll. */
export function AuthFrame({ children, footer, wide = false }: { children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Link to="/login" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="Kaampilot: sign in">
          <BrandLockup size={30} domain />
        </Link>
      </header>
      <main id="content" className="flex flex-1 items-start justify-center px-4 pt-4 pb-10 sm:items-center sm:pt-0">
        <div className={cn('w-full min-w-0', wide ? 'max-w-[560px]' : 'max-w-[420px]')}>{children}</div>
      </main>
      {footer && <footer className="px-4 pb-6 text-center text-sm text-muted-foreground">{footer}</footer>}
    </div>
  );
}

/** "Step 2 of 5" with a segmented bar (square segments, no dots). */
export function StepProgress({ step, total, label }: { step: number; total: number; label?: string }) {
  return (
    <div className="mb-6">
      <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={`Step ${step} of ${total}${label ? `: ${label}` : ''}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} aria-hidden className={cn('h-1 flex-1 rounded-sm transition-colors', i < step ? 'bg-primary' : 'bg-border')} />
        ))}
      </div>
      <p className="mt-2 font-mono text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Step {step} of {total}
        {label ? ` · ${label}` : ''}
      </p>
    </div>
  );
}

/** Title + one quiet line; the title takes focus when the step changes, so screen readers hear the new question. */
export function StepTitle({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div className="mb-6">
      <h1 ref={ref} tabIndex={-1} className="text-[26px] leading-tight font-bold tracking-tight outline-none sm:text-[28px]">
        {title}
      </h1>
      {children && <p className="mt-1.5 text-[15px] text-muted-foreground">{children}</p>}
    </div>
  );
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground" onClick={onClick}>
      <ArrowLeft /> {label}
    </Button>
  );
}

/** An error from the server, read out when it appears. */
export function FormError({ children, id }: { children: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** A labelled field with its own error line (announced). */
export function TextField({
  id,
  label,
  error,
  hint,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; error?: string | null; hint?: ReactNode }) {
  const describedBy = [error ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={cn('h-11', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Username (PLAN.md §21.5) with its live check next to it: "Available" (success text), the server's message (error
 * text), or "Checking…". `serverError` (taken at submit) wins over the live state until the name is changed.
 */
export function UsernameField({
  id,
  value,
  onChange,
  check,
  serverError,
  autoFocus,
  label = 'Username',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  check: { state: UsernameCheckState; message: string | null };
  serverError?: string | null;
  autoFocus?: boolean;
  label?: string;
}) {
  const problem = serverError ?? (['taken', 'invalid', 'reserved', 'error'].includes(check.state) ? check.message : null);
  const statusId = `${id}-status`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="h-11"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s+/g, ''))}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={30}
        autoFocus={autoFocus}
        aria-invalid={problem ? true : undefined}
        aria-describedby={statusId}
      />
      <LiveCheckLine id={statusId} problem={problem} state={check.state} idle="You can sign in with it. Letters, numbers, dots, - or _." />
    </div>
  );
}

/**
 * Company name (PLAN.md §21.6: unique across Kaampilot) with its live check: "Available", the server's message, or
 * "Checking…". `error`: a local or submit-time message (409 taken), shown until the name is changed.
 */
export function CompanyNameField({
  id,
  value,
  onChange,
  check,
  error,
  autoFocus,
  label = 'Company name',
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  check: { state: CompanyNameCheckState; message: string | null };
  error?: string | null;
  autoFocus?: boolean;
  label?: string;
}) {
  const problem = error ?? (['taken', 'error'].includes(check.state) || (check.state === 'invalid' && value.trim()) ? check.message : null);
  const statusId = `${id}-status`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="h-11"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="organization"
        maxLength={80}
        autoFocus={autoFocus}
        aria-invalid={problem ? true : undefined}
        aria-describedby={statusId}
      />
      <LiveCheckLine id={statusId} problem={problem} state={check.state} />
    </div>
  );
}

/** Password with Show / Hide and the weak-password warning (never blocks; at least 6 characters). */
export function PasswordField({
  id,
  label = 'Password',
  value,
  onChange,
  error,
  about,
  newPassword = true,
  autoFocus,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  about?: PasswordAbout;
  newPassword?: boolean;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  const weakId = `${id}-weak`;
  const describedBy = [error ? `${id}-error` : '', newPassword ? `${id}-hint ${weakId}` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          className="h-11 pr-20"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-pressed={show}
          aria-controls={id}
          className="absolute top-1/2 right-1 flex h-9 min-w-16 -translate-y-1/2 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-[13px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {newPassword && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          At least {PLATFORM_PASSWORD_MIN} characters.
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      )}
      {newPassword && <WeakPasswordNote id={weakId} password={value} about={about} />}
    </div>
  );
}

/** The 6-digit one-time code: one big field (paste and SMS autofill work), digits only. */
export function CodeField({ value, onChange, error, label = 'Code' }: { value: string; onChange: (v: string) => void; error?: string | null; label?: string }) {
  return (
    <TextField
      id="otp-code"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      autoFocus
      error={error}
      className="h-14 text-center font-mono text-2xl tracking-[0.5em] max-sm:text-2xl"
    />
  );
}

/** Shown while the OTP sender is fake (the server echoes the code in dev). Clearly marked as a test. */
export function DevCodeNote({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-dashed border-warning/50 bg-warning/8 px-3 py-2 text-sm" role="note">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>
        <span className="font-semibold">Test mode:</span> your code is <span className="font-mono font-bold tracking-widest">{code}</span>
      </span>
    </p>
  );
}

/** Seconds between two codes for one email / mobile (the server's gap; a 429 says exactly how long is left). */
const RESEND_GAP_S = 30;

/** Whole seconds left until `until` (ms), ticking every second; 0 once it has passed. */
function useSecondsLeft(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * When a new one-time code may be asked for: 30 s after a code was sent, or as long as the server says when it
 * refuses one (429 `retryAfterSeconds`). `throttled(err)` is true for that refusal, so the page shows the countdown
 * instead of the server's message.
 */
export function useCodeTimer() {
  const [until, setUntil] = useState(0);
  const left = useSecondsLeft(until);
  return {
    left,
    sent: () => setUntil(Date.now() + RESEND_GAP_S * 1000),
    throttled: (err: unknown) => {
      const s = retryAfterSeconds(err);
      if (s) setUntil(Date.now() + s * 1000);
      return s !== null;
    },
  };
}

/** "You can ask for a new code in 24 s." (live, polite: read when it appears, not every second). */
export function CodeWait({ left }: { left: number }) {
  if (left <= 0) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>
        A code was sent a moment ago. You can ask for a new code in <span className="font-semibold tabular-nums">{left} s</span>.
      </span>
    </p>
  );
}

/** "Resend code" once the wait is over; until then a live countdown. */
export function ResendCode({ onResend, busy, left }: { onResend: () => void; busy?: boolean; left: number }) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      {left > 0 ? (
        <span>
          Didn’t get it? You can ask for a new code in <span className="tabular-nums">{left} s</span>.
        </span>
      ) : (
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onResend} loading={busy}>
          Resend code
        </Button>
      )}
    </p>
  );
}

/** The server's error, except a "wait before a new code" refusal (shown as the countdown instead). */
export function codeError(err: unknown, active: boolean): string | null {
  if (!active || retryAfterSeconds(err) !== null || channelOff(err, active)) return null;
  return errorMessage(err);
}

/**
 * "Codes by SMS aren't set up yet. Use your email address instead." (or the email twin; 503, PLAN.md §21.8): shown on
 * the email / mobile field itself, since the fix is to type the other one there. null for any other error.
 */
export function channelOff(err: unknown, active: boolean): string | null {
  if (!active || !(err instanceof ApiError) || err.status !== 503) return null;
  return /aren['’]t set up yet/i.test(err.message) ? err.message : null;
}

/** Where the code went: "We sent a 6-digit code to a@b.com". */
export function sentTo(identifier: string, channel?: string) {
  return `We sent a 6-digit code to ${identifier}${channel === 'sms' ? ' by SMS' : ''}.`;
}
