/** The four public policy links (PLAN.md §21.11), small so the sign-in page does not load the policy texts. */
import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

export const LEGAL_LINKS = [
  { to: '/contact', label: 'Contact us' },
  { to: '/terms', label: 'Terms & Conditions' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/refunds', label: 'Refund & Cancellation' },
] as const;

/** The four policy links in one line: the sign-in page and the foot of every policy page. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Policies" className={cn('text-xs text-muted-foreground', className)}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {LEGAL_LINKS.map((l) => (
          <li key={l.to}>
            <NavLink to={l.to} className={({ isActive }) => cn('hover:text-foreground hover:underline', isActive && 'font-semibold text-foreground')}>
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
