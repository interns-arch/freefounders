import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/primitives';
import { AuthProvider } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import { router } from './router';
import './index.css';

function ThemedToaster() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors closeButton toastOptions={{ duration: 4500 }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={250}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
      <ThemedToaster />
    </QueryClientProvider>
  </StrictMode>,
);
