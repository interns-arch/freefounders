import type { Access } from '@kaampilot/core';
import { Link } from 'react-router';
import { EmptyState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { CreditCard } from '@/components/icons';

const NAMES = { tasks: 'Tasks', attendance: 'Attendance' } as const;

/**
 * A direct link to an area the company's plan does not include (PLAN.md §24.1): Tasks and Attendance are sold one by
 * one, and the API refuses the other one with 403. Shown in place of the screen, with the way to Billing for those who
 * may open it.
 */
export function NotInPlan({ area, access }: { area: keyof typeof NAMES; access: Access }) {
  const name = NAMES[area];
  return (
    <EmptyState
      icon={CreditCard}
      title={`${name} is not in your plan`}
      description={access.canManageBilling ? `Add ${name} to your plan in Billing to use it.` : `Ask your company owner to add ${name} in Billing.`}
      action={
        access.canManageBilling ? (
          <Button asChild>
            <Link to="/billing">Open Billing</Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link to="/?home=1">Go to Home</Link>
          </Button>
        )
      }
    />
  );
}
