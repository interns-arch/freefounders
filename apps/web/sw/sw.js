/**
 * The FreeFounders web app's service worker (PLAN.md §19.18): keeps the app's own files on the phone, so the second
 * launch starts at once and downloads almost nothing. Built by vite-plugin-pwa (injectManifest): `self.__WB_MANIFEST`
 * becomes the list of built files (index.html, /static/* scripts, styles and fonts) with their revisions.
 *
 * - App files (/static/*, index.html, theme.js, favicon) come from the cache; a new build replaces them as a whole.
 * - Page loads (navigations) go to the network first, so a new deploy shows on the next load; only when the network
 *   fails or takes longer than 4 s does the cached index.html start the app (offline start).
 * - Data never comes from here: /api/*, /tasks/api/*, /assets/api/*, /media/* (and anything else not listed above)
 *   are left to the network untouched.
 * - A new version takes over at once (skipWaiting + clientsClaim); the open app then offers "Reload".
 * The old Tasks app's worker under /tasks/ is a separate kill-switch (public/tasks/sw.js), kept for old phones.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

/** Paths that are data or files of the APIs: never answered by this worker. */
const NEVER_CACHE = [/^\/api\//, /^\/tasks\/api\//, /^\/assets\/api\//, /^\/media\//];

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

/** The page from the network, or nothing after `ms` (a slow network then starts from the cached shell). */
function fromNetwork(request, ms) {
  return Promise.race([fetch(request), new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      const shell = () => matchPrecache('/index.html');
      try {
        const res = await fromNetwork(request, 4000);
        if (res && res.ok) return res;
        return (await shell()) ?? res ?? fetch(request);
      } catch {
        // Offline (or the server is down): start the app from the cached shell; its screens say what is unreachable.
        const cached = await shell();
        if (cached) return cached;
        throw new Error('offline');
      }
    },
    { denylist: [...NEVER_CACHE, /^\/tasks\/sw\.js$/] },
  ),
);

// After the page route (first match wins), and without "/" → index.html, so "/" stays network-first too.
precacheAndRoute(self.__WB_MANIFEST, { directoryIndex: null, cleanURLs: false });
