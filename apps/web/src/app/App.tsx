import { createQueryClient } from '@freefounders/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { ConfirmProvider } from '@/components/common/confirm';
import { TooltipProvider } from '@/components/ui/primitives';
import { router } from './router';

const queryClient = createQueryClient();

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
