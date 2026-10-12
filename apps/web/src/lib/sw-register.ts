/**
 * Registers the app's service worker (sw/sw.js, PLAN.md §19.18) in production builds: the app's files stay on the
 * phone, so the next launch starts at once. Not in `vite dev`, and only where the browser allows service workers
 * (https or localhost; Android's WebView too). A new deploy takes over by itself; the open app then shows
 * "A new version is ready" with Reload, so nobody loses what they are typing.
 */
import { toast } from 'sonner';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // A controller before registering = an older version is running; a new one taking over later means an update.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true; // the first install: this page already runs the current files
      return;
    }
    toast('A new version is ready', {
      id: 'ff-update',
      duration: Infinity,
      action: { label: 'Reload', onClick: () => window.location.reload() },
    });
  });
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(
      (reg) => {
        // Look for a new deploy when the app comes back to the front (phones keep the app open for days).
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) void reg.update().catch(() => {});
        });
      },
      () => {
        /* not allowed here (e.g. http on a LAN address): the app works as before, just without the offline copy */
      },
    );
  };
  // Well after the page has loaded and when the phone is idle: the first visit's own downloads and work come first
  // (the worker then fetches the app's files in the background, once per deploy).
  const later = () =>
    setTimeout(() => {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(register, { timeout: 10_000 });
      else register();
    }, 5000);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}
