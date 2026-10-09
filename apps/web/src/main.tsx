import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/index.css';

// Light or dark, as chosen last time on this device (the switch is in the header).
try {
  if (localStorage.getItem('ff-theme') === 'dark') document.documentElement.classList.add('dark');
} catch {
  /* private mode: light */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
