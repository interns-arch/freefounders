/**
 * Pieces of the public account pages (sign-up, join, forgot password, new company; PLAN.md §20.5, §21): a calm centred
 * frame like Notion's, one question per screen, a progress bar, a back button, the one-time-code field and its
 * "Test mode" note.
 */
import { type PasswordAbout, PLATFORM_PASSWORD_MIN } from '@freefounders/core/admin';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Info } from '@/components/icons';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { WeakPasswordNote } from '@/components/common/weak-password-note';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Logo } from '@/app/shell-parts';

/** The page around a public step: logo, one card, a quiet footer. Phones: full width with 16 px gutters, no sideways scroll. */
export function AuthFrame({ children, footer, wide = false }: { children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Link to="/login" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" aria-label="FreeFounders">
          <Logo />
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

/** "Resend code" after a countdown (30 s). */
export function ResendCode({ onResend, busy, resetKey }: { onResend: () => void; busy?: boolean; resetKey: unknown }) {
  const [left, setLeft] = useState(30);
  useEffect(() => setLeft(30), [resetKey]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const id = useId();
  return (
    <p className="text-center text-sm text-muted-foreground" id={id}>
      {left > 0 ? (
        <span aria-live="off">Didn’t get it? You can resend in {left} s.</span>
      ) : (
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onResend} loading={busy}>
          Resend code
        </Button>
      )}
    </p>
  );
}

/** Where the code went: "We sent a 6-digit code to a@b.com". */
export function sentTo(identifier: string, channel?: string) {
  return `We sent a 6-digit code to ${identifier}${channel === 'sms' ? ' by SMS' : ''}.`;
}
