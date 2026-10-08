/**
 * Query keys and cache helpers for the Assets screens. Every Assets key starts with "assets" so it can never clash
 * with Tasks / HR / Admin keys in the one shared cache; after that it is the old Assets web app's key
 * (e.g. ['assets', 'employee', id] was ['employee', id]).
 */
import { type QueryClient, useMutation, type UseMutationOptions, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

export const assetsKey = (...parts: unknown[]) => ['assets', ...parts] as const;

/** Everything that depends on assets / custody changes; invalidated after any asset mutation. */
export function invalidateAssetData(qc: QueryClient) {
  return Promise.all(
    ['assets', 'asset', 'employees', 'employee', 'exits', 'exit', 'dashboard', 'requests', 'maintenance', 'asset-types', 'history'].map((k) =>
      qc.invalidateQueries({ queryKey: assetsKey(k) }),
    ),
  );
}

export interface AssetsCache {
  /** Reload these (old-style) keys, e.g. invalidate(['requests'], ['dashboard']) or invalidate('requests'). */
  invalidate: (...keys: Array<string | readonly unknown[]>) => Promise<unknown>;
  /** Everything that shows assets or who holds them. */
  invalidateAssetData: () => Promise<unknown>;
}

/** Cache helpers for screens (refresh after a change). */
export function useAssetsCache(): AssetsCache {
  const qc = useQueryClient();
  return useMemo(
    () => ({
      invalidate: (...keys) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: assetsKey(...(typeof k === 'string' ? [k] : k)) }))),
      invalidateAssetData: () => invalidateAssetData(qc),
    }),
    [qc],
  );
}

/** Options a screen may pass to a mutation hook (everything except the request itself). */
export type MutationOptions<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>;

/** Builds a mutation hook from an API function. */
export function mutationHook<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  return (options?: MutationOptions<TData, TVars>) => useMutation<TData, Error, TVars>({ ...options, mutationFn: fn });
}

/** Cached lists for dropdowns. */
export const LOOKUP_OPTS = { staleTime: 5 * 60_000, placeholderData: undefined } as const;
