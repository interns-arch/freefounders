/**
 * Shared look of the public visitor pages (PLAN.md §22.11): the company's brand colour as a solid header band and
 * accents (no gradients), the logo + name, a big 4-digit code, and the phone's device secret (localStorage copy; the
 * API also keeps an httpOnly cookie copy). No sign-in, any phone browser.
 */
import { type ReactNode, useEffect } from 'react';
import { BrandLockup } from '@/components/brand';
import { brandCss } from '@/lib/brand-colour';
import { cn } from '@/lib/utils';

const DEVICE_KEY = (company: string) => `kp-visitor-device:${company}`;

/** This phone's device secret for the company (null when it never signed in here, or storage is blocked). */
export function readDevice(company: string): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY(company));
  } catch {
    return null;
  }
}
/** This phone stops following its visit (the next sign-in on this phone is someone else's). */
export function forgetDevice(company: string) {
  try {
    localStorage.removeItem(DEVICE_KEY(company));
  } catch {
    /* storage blocked: nothing kept */
  }
}
export function saveDevice(company: string, device: string) {
  try {
    localStorage.setItem(DEVICE_KEY(company), device);
  } catch {
    /* private mode: the cookie copy still works */
  }
}

/** The company's brand colour replaces --primary on the public page (readable in both themes, lib/brand-colour.ts). */
export function usePublicBrand(colour: string | null | undefined) {
  useEffect(() => {
    const id = 'ff-brand-colour';
    const text = brandCss(colour);
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = text;
  }, [colour]);
}

/** The page frame: a solid brand-colour band with the company's logo + name and a welcome line, the content card
 * overlapping it, and a small "Kaampilot" footer. */
export function PublicShell({
  company,
  logoUrl,
  kicker,
  title,
  subtitle,
  children,
}: {
  company: string;
  logoUrl?: string | null;
  kicker: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="bg-primary px-4 pt-5 pb-16 text-primary-foreground">
        <div className="mx-auto flex w-full max-w-md items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="size-11 shrink-0 rounded-md bg-card object-contain p-1" />
          ) : (
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-md bg-primary-foreground/15 text-lg font-bold">
              {(company || 'K').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[17px] leading-tight font-semibold">{company || 'Visitors'}</p>
            <p className="text-[13px] font-medium tracking-wide uppercase">{kicker}</p>
          </div>
        </div>
        <div className="mx-auto mt-6 w-full max-w-md">
          <h1 className="text-[28px] leading-tight font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px]">{subtitle}</p>}
        </div>
      </header>
      <main id="content" className="-mt-10 flex flex-1 justify-center px-4 pb-6">
        <div className="w-full max-w-md space-y-4">{children}</div>
      </main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-[13px] text-muted-foreground">
        <span>Visitor desk by</span>
        <BrandLockup size={18} />
      </footer>
    </div>
  );
}

/** A white card on the page. */
export function PublicCard({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border bg-card p-5 shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

/** The 4-digit code in big separate boxes (read out digit by digit to the guard). */
export function BigCode({ code, label, testId }: { code: string; label: string; testId?: string }) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-[13px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">{label}</p>
      <p className="sr-only">{code.split('').join(' ')}</p>
      <div aria-hidden className="flex justify-center gap-2.5" data-testid={testId}>
        {code.split('').map((d, i) => (
          <span key={i} className="grid h-20 w-16 place-items-center rounded-lg border-2 border-primary bg-primary/10 font-mono text-5xl font-bold text-primary">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

/** "valid till 14:30" */
export function until(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
