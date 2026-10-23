import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from '@/app/App';
import '@/index.css';
import { installAppDownloadLinks } from '@/lib/native-bridge';
import { registerServiceWorker } from '@/lib/sw-register';

// Light or dark, as chosen last time on this device (the switch is in the header).
try {
  if (localStorage.getItem('ff-theme') === 'dark') document.documentElement.classList.add('dark');
} catch {
  /* private mode: light */
}

// Form rules check values without generating code (zod's fast path uses `new Function`), so the production
// Content-Security-Policy can forbid eval (infra/gateway/Caddyfile, docs/security/assets-web-mobile-infra.md).
z.config({ jitless: true });

// Lite mode was removed (founder, 2026-10-23; PLAN.md §19.36): forget a choice saved by an older version.
try {
  localStorage.removeItem('ff-lite');
} catch {
  /* private mode */
}

// Inside the phone app, file links (e.g. Assets photos) are saved through the app (PLAN.md §19.17).
installAppDownloadLinks();

// The app's files stay on the phone for the next launch (production builds only, PLAN.md §19.18).
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
