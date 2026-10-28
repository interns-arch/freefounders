import { useAccess } from '@kaampilot/core';
import { ExternalLink } from '@/components/icons';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { ADMIN_SCREENS } from './nav';

/** Where a person is opened in Admin → People: their form when the Platform id is known, else a search. */
export function peopleHref({ personId, query }: { personId?: string | null; query?: string | null }): string {
  if (personId) return `/people?person=${encodeURIComponent(personId)}`;
  return query?.trim() ? `/people?q=${encodeURIComponent(query.trim())}` : '/people';
}

/**
 * The small "Manage in People" link next to a person's details outside Admin (PLAN.md §26): people are added, edited,
 * switched off and given roles only in People. Shown only to those who may open People; everyone else sees nothing.
 */
export function ManageInPeople({ personId, query, className, label = 'Manage in People' }: { personId?: string | null; query?: string | null; className?: string; label?: string }) {
  const access = useAccess();
  if (!ADMIN_SCREENS.people(access)) return null;
  return (
    <Link to={peopleHref({ personId, query })} className={cn('inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline', className)} onClick={(e) => e.stopPropagation()}>
      {label} <ExternalLink className="size-3.5" />
    </Link>
  );
}
