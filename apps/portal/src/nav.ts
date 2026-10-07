import { useEffect, useState } from 'react';

/** In-page navigation for the portal's few screens (/, /account, /people). */
export function navigate(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

const REMEMBER_KEY = 'ff.app';

/** "Remember my choice" on this device. */
export function rememberedApp(): string | null {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

export function remember(app: string | null) {
  try {
    if (app) localStorage.setItem(REMEMBER_KEY, app);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* private mode or storage blocked */
  }
}
