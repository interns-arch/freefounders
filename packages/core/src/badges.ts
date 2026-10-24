/**
 * Count badges (PLAN.md §19.42): one small request per app a minute (and when the window gets focus) for what waits
 * for me: Tasks (my open tasks, work to accept, requests to decide), Attendance (approvals), Assets (requests, tickets,
 * exits). Every successful change anywhere in the app refreshes it (createQueryClient), so a count drops right after
 * an approval.
 */
import { useQuery } from '@tanstack/react-query';
import { useClaims } from './access';
import { type AssetsBadgesResponse, type Badges, NO_BADGES, type TasksBadgesResponse, toBadges } from './badge-count';
import { assetsApi, tasksApi } from './http';

export const BADGES_KEY = ['badges'] as const;

export function useBadges(): Badges {
  const claims = useClaims();
  const tasksOn = !!claims?.apps?.tasks;
  const assetsOn = !!claims?.apps?.assets;
  const q = useQuery({
    queryKey: [...BADGES_KEY, claims?.sub, claims?.cid, tasksOn, assetsOn],
    enabled: !!claims && (tasksOn || assetsOn),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    queryFn: async () => {
      const [t, a] = await Promise.all([
        tasksOn ? tasksApi.get<TasksBadgesResponse>('/badges/').catch(() => null) : null,
        assetsOn ? assetsApi.get<AssetsBadgesResponse>('/badges').catch(() => null) : null,
      ]);
      return toBadges(t, a);
    },
  });
  return q.data ?? NO_BADGES;
}
