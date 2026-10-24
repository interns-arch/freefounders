import { keepPreviousData, MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './http';

/**
 * One cache for the whole app. Client errors (4xx) are not retried. Any successful change refreshes the count badges
 * (PLAN.md §19.42): approving, accepting or finishing something makes its counter drop at once.
 */
export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: ['badges'] });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 10 * 60_000,
        placeholderData: keepPreviousData,
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
  return client;
}

/** Cached for minutes: lists for dropdowns (departments, roles, categories…). */
export const LOOKUP = { staleTime: 5 * 60_000, placeholderData: undefined } as const;
