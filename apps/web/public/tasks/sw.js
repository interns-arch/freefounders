// The old Tasks web app installed a service worker at /tasks/ that serves its cached pages. This replacement
// (PLAN.md §18.4) removes itself and reloads open tabs, so phones get the new FreeFounders app. It deletes the old
// app's caches but keeps the new app's own (workbox-* of the "/" worker, PLAN.md §19.18).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('workbox-') && !key.includes('/tasks/')) continue;
        await caches.delete(key);
      }
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
