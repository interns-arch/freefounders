import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/index.css';
import { installLite } from '@/lib/lite';
import { installAppDownloadLinks } from '@/lib/native-bridge';
import { registerServiceWorker } from '@/lib/sw-register';

// Light or dark, as chosen last time on this device (the switch is in the header).
try {
  if (localStorage.getItem('ff-theme') === 'dark') document.documentElement.classList.add('dark');
} catch {
  /* private mode: light */
}

// Lite mode on weak phones (PLAN.md §19.18): set before the first render, so nothing costly is painted even once.
installLite();

// Inside the phone app, file links (e.g. Assets photos) are saved through the app (PLAN.md §19.17).
installAppDownloadLinks();

// The app's files stay on the phone for the next launch (production builds only, PLAN.md §19.18).
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
