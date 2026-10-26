/**
 * Subscription banners at the top of the app frame (PLAN.md §21.1): trial days left (owner / billing managers),
 * failed payment and read-only (everyone). Compact; the trial one can be hidden for the day.
 */
import type { Access } from '@kaampilot/core';
import { AlertTriangle, Clock, Lock, X } from '@/components/icons';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

const HIDE_KEY = (cid: string) => `ff-trial-banner-hidden:${cid}:${new Date().toISOString().slice(0, 10)}`;
function readHidden(cid: string | undefined) {
  if (!cid) return false;
  try {
    return localStorage.getItem(HIDE_KEY(cid)) === '1';
  } catch {
    return false;
  }
}

const days = (n: number | null | undefined) => (n == null ? '' : `${n} day${n === 1 ? '' : 's'}`);

export function BillingBanners({ access }: { access: Access }) {
  const b = access.billing;
  const cid = access.claims?.cid;
  const [hidden, setHidden] = useState(() => readHidden(cid));
  if (!b) return null;
  const manage = access.canManageBilling;

  if (b.state === 'trialing' && manage && !hidden) {
    return (
      <Banner
        tone="info"
        icon={<Clock className="size-4 shrink-0" aria-hidden />}
        onClose={() => {
          setHidden(true);
          try {
            if (cid) localStorage.setItem(HIDE_KEY(cid), '1');
          } catch {
            /* private mode */
          }
        }}
      >
        Trial: {b.daysLeft != null ? `${days(b.daysLeft)} left` : 'ends soon'} ·{' '}
        <Link to="/billing" className="font-semibold underline underline-offset-2">
          Choose a plan
        </Link>
      </Banner>
    );
  }
  if (b.state === 'past_due') {
    // Cashfree: nothing renews by itself, so past due means the next period is waiting to be paid.
    const due = !!b.paysEachPeriod;
    return (
      <Banner tone="warning" icon={<AlertTriangle className="size-4 shrink-0" aria-hidden />}>
        {due ? 'The paid period has ended.' : 'Payment failed.'}{' '}
        {manage ? (
          <>
            <Link to="/billing" className="font-semibold underline underline-offset-2">
              {due ? 'Pay for the next period in Billing' : 'Update payment in Billing'}
            </Link>
            {b.daysLeft != null && ` (${days(b.daysLeft)} before read-only)`}
          </>
        ) : (
          <>
            Owner: {due ? 'pay for the next period' : 'update payment'} in Billing{b.daysLeft != null && ` (${days(b.daysLeft)} before read-only)`}.
          </>
        )}
      </Banner>
    );
  }
  if (b.readOnly || b.state === 'read_only') {
    return (
      <Banner tone="danger" icon={<Lock className="size-4 shrink-0" aria-hidden />}>
        Read-only: the subscription has ended.{' '}
        {manage ? (
          <Link to="/billing" className="font-semibold underline underline-offset-2">
            Renew
          </Link>
        ) : (
          'You can look and export; ask the owner to renew.'
        )}
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, icon, children, onClose }: { tone: 'info' | 'warning' | 'danger'; icon: ReactNode; children: ReactNode; onClose?: () => void }) {
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'flex items-center gap-2 border-b px-3 py-1.5 text-[13px] lg:px-6',
        tone === 'info' && 'border-primary/20 bg-primary/8 text-foreground [&_svg]:text-primary',
        tone === 'warning' && 'border-warning/30 bg-warning/12 text-foreground [&_svg]:text-warning',
        tone === 'danger' && 'border-destructive/30 bg-destructive/10 text-foreground [&_svg]:text-destructive',
      )}
    >
      {icon}
      <p className="min-w-0 flex-1">{children}</p>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Hide for today" className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
