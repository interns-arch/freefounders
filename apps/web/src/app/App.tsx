import { createQueryClient } from '@freefounders/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/common/confirm';
import { TooltipProvider } from '@/components/ui/primitives';
import { installQueryPersistence } from './query-persist';
import { router } from './router';

const queryClient = createQueryClient();
// The last data of a few personal queries is kept on this device and shown at once after a reload (PLAN.md §19.18).
installQueryPersistence(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" richColors closeButton />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
