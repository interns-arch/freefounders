/**
 * App start: renew the sign-in from the stored refresh token. Three outcomes: signed in, signed out (no token or the
 * server refused it: the store is cleared), or offline (a token is kept but the server could not be reached).
 */
import { session } from '@freefounders/core';
import { useCallback, useEffect, useState } from 'react';
import { refreshStore } from './core';

export type BootState = 'starting' | 'ready' | 'offline';

export function useBoot() {
  const [state, setState] = useState<BootState>('starting');
  const run = useCallback(async () => {
    setState('starting');
    if (await session.refresh()) return setState('ready');
    setState((await refreshStore.get()) ? 'offline' : 'ready');
  }, []);
  useEffect(() => {
    void run();
  }, [run]);
  return { state, retry: run };
}
