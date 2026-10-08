// The old Tasks web app installed a service worker at /tasks/ that serves its cached pages. This replacement
// (PLAN.md §18.4) removes itself and reloads open tabs, so phones get the new FreeFounders app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
