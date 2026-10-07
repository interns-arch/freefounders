import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import type { Permission } from '@eam/shared';
import { api, ApiError, UNAUTHORIZED_EVENT } from './api';
import { PLATFORM, platformLogout } from './platform';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (...permissions: Permission[]) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(['me'], null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  const me = query.data ?? null;
  const perms = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const can = useCallback((...permissions: Permission[]) => permissions.some((p) => perms.has(p)), [perms]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    if (PLATFORM) await platformLogout();
    await qc.cancelQueries();
    // Update "me" through its live observer first (clear() would detach it and leave the old user
    // on screen), then drop everything else this user loaded.
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({ me, loading: query.isLoading, can, logout, refresh: () => query.refetch() }),
    [me, query.isLoading, can, logout, query],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Renders children only when the user has one of the permissions. */
export function Can({ perm, children, fallback = null }: { perm: Permission | Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  return <>{can(...(Array.isArray(perm) ? perm : [perm])) ? children : fallback}</>;
}
