import type { Permission } from '@eam/shared';
import { useAccess } from '@freefounders/core';
import type { Me } from '@freefounders/core/assets';

/**
 * The Assets screens' view of who is signed in (was lib/auth.tsx in the Assets app): the Assets /me and its
 * permissions, from the one sign-in (useAccess).
 */
export function useAuth(): { me: Me | null; can: (...permissions: Permission[]) => boolean } {
  const access = useAccess();
  return { me: (access.assets.me as Me | undefined) ?? null, can: access.assets.can };
}

/** On unless the company switched it off (PLAN.md §16.2). */
export function useModules() {
  return useAccess().assets.module;
}

/** Tidy display name: "CARTREND AUTOPARTS PVT LTD" → "Cartrend Autoparts". */
function shortCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.replace(/\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?)\b/gi, '').replace(/\s+/g, ' ').trim();
  return trimmed.replace(/\w\S*/g, (w) => (w.length > 3 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w));
}

/** The company's full and short name (ID cards, labels, the dashboard greeting). */
export function useCompanyName() {
  const access = useAccess();
  const config = access.assets.config;
  const full = config?.companyName ?? access.brand?.name ?? null;
  const brand = config?.brand ?? null;
  const short = brand?.shortName || access.brand?.shortName || shortCompanyName(full);
  return { full, short, brand };
}
