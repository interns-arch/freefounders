import { useCallback, useEffect, useState } from 'react';
import { type AppInfo, call, isAdmin, logout, type Me, refresh } from './api';
import { AccountPage } from './pages/Account';
import { ChooserPage } from './pages/Chooser';
import { LoginPage } from './pages/Login';
import { navigate, remember, rememberedApp, usePath } from './nav';
import { PeoplePage } from './pages/People';

/** Only ever send people back into one of their own apps on this site. */
function safeNext(apps: AppInfo[]): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return apps.some((a) => next.startsWith(a.path)) ? next : null;
}

type State = { phase: 'loading' } | { phase: 'signed-out' } | { phase: 'ready'; me: Me };

export function App() {
  const path = usePath();
  const [state, setState] = useState<State>({ phase: 'loading' });

  /** After sign-in (or on a fresh visit with a live session): go where the person needs to be. */
  const proceed = useCallback(async (opts: { fromLogin?: boolean } = {}) => {
    const me = await call<Me>('GET', '/auth/me');
    const params = new URLSearchParams(window.location.search);
    if (me.mustChangePassword) {
      setState({ phase: 'ready', me });
      if (window.location.pathname !== '/account') navigate(`/account?first=1${params.get('next') ? `&next=${encodeURIComponent(params.get('next')!)}` : ''}`);
      return;
    }
    const next = safeNext(me.apps);
    if (next) return window.location.assign(next);

    const onHome = window.location.pathname === '/';
    if (onHome && !params.has('choose')) {
      const saved = me.apps.find((a) => a.app === rememberedApp());
      if (saved) return window.location.assign(saved.path);
      if (me.apps.length === 1 && !isAdmin(me)) return window.location.assign(me.apps[0].path);
    }
    if (opts.fromLogin && !onHome) navigate('/');
    setState({ phase: 'ready', me });
  }, []);

  useEffect(() => {
    void (async () => {
      if (await refresh()) {
        try {
          return await proceed();
        } catch {
          /* fall through to sign-in */
        }
      }
      setState({ phase: 'signed-out' });
    })();
  }, [proceed]);

  const signOut = useCallback(async () => {
    await logout();
    remember(null);
    window.history.replaceState(null, '', '/');
    setState({ phase: 'signed-out' });
  }, []);

  if (state.phase === 'loading') {
    return (
      <div className="center">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (state.phase === 'signed-out') {
    return <LoginPage onSignedIn={() => proceed({ fromLogin: true })} />;
  }

  const { me } = state;
  if (path === '/account') {
    return <AccountPage me={me} onDone={() => proceed({ fromLogin: true })} onSignOut={signOut} />;
  }
  if (path === '/people' && isAdmin(me)) {
    return <PeoplePage me={me} onSignOut={signOut} />;
  }
  return <ChooserPage me={me} onSignOut={signOut} />;
}
