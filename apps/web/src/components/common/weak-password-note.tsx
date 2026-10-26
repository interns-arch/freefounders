import { type PasswordAbout, PLATFORM_PASSWORD_MIN, weakPasswordWarning } from '@kaampilot/core/admin';
import { AlertTriangle } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Under a set-password field: a warning when the typed password is easy to guess (docs/security/platform.md R3).
 * Never blocks saving. Quiet until the password is long enough to be saved at all.
 */
export function WeakPasswordNote({ password, about, id, className }: { password: string; about?: PasswordAbout; id?: string; className?: string }) {
  const warning = password.length >= PLATFORM_PASSWORD_MIN ? weakPasswordWarning(password, about) : null;
  return (
    <p id={id} aria-live="polite" className={cn('flex items-start gap-1.5 text-xs font-medium text-warning empty:hidden', className)}>
      {warning && (
        <>
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{warning}</span>
        </>
      )}
    </p>
  );
}
