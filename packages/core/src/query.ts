import { keepPreviousData, QueryClient } from '@tanstack/react-query';
import { ApiError } from './http';

/** One cache for the whole app. Client errors (4xx) are not retried. */
export function createQueryClient() {
  return new QueryClient({
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
}

/** Cached for minutes: lists for dropdowns (departments, roles, categories…). */
export const LOOKUP = { staleTime: 5 * 60_000, placeholderData: undefined } as const;
