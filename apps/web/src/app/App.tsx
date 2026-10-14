import { createQueryClient, onPaymentRequired } from '@freefounders/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { RouterProvider } from 'react-router';
import { toast, Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/common/confirm';
import { TooltipProvider } from '@/components/ui/primitives';
import { installQueryPersistence } from './query-persist';
import { router } from './router';

const queryClient = createQueryClient();
// The last data of a few personal queries is kept on this device and shown at once after a reload (PLAN.md §19.18).
installQueryPersistence(queryClient);

/** True while the app is in dark mode (the account menu toggles the class on <html>). */
function useDarkClass(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const obs = new MutationObserver(notify);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => obs.disconnect();
    },
    () => document.documentElement.classList.contains('dark'),
  );
}

/**
 * Toasts follow light/dark, and on phones they sit above the bottom bar instead of covering it. Sonner announces them
 * politely and never takes focus; they close by themselves after 4 s (paused while hovered) or with the × button.
 */
function AppToaster() {
  const dark = useDarkClass();
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme={dark ? 'dark' : 'light'}
      duration={4000}
      mobileOffset={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))', left: '1rem', right: '1rem' }}
    />
  );
}

/**
 * 402 = a plan, seat or read-only limit (PLAN.md §21.2): whatever screen asked, its message shows as one toast (the
 * same id, so a burst of refused requests shows once).
 */
function usePaymentRequiredToast() {
  useEffect(
    () =>
      onPaymentRequired((err) => {
        toast.error(err.message || 'Your plan does not allow this.', { id: 'payment-required' });
      }),
    [],
  );
}

export function App() {
  usePaymentRequiredToast();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          <RouterProvider router={router} />
          <AppToaster />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
