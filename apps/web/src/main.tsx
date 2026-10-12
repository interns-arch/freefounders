import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/index.css';
import { installAppDownloadLinks } from '@/lib/native-bridge';

// Light or dark, as chosen last time on this device (the switch is in the header).
try {
  if (localStorage.getItem('ff-theme') === 'dark') document.documentElement.classList.add('dark');
} catch {
  /* private mode: light */
}

// Inside the phone app, file links (e.g. Assets photos) are saved through the app (PLAN.md §19.17).
installAppDownloadLinks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
