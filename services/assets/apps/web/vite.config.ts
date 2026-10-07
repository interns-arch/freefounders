import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // '/assets/' when built for the FreeFounders shared address (see src/lib/platform.ts).
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Use the shared package's TypeScript source directly (instant HMR, one set of rules).
      '@eam/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? '3000'}` },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
});
