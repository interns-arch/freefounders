import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The FreeFounders web app (PLAN.md §18). Served at "/" on the shared address; the gateway sends the APIs
// (/api/platform, /tasks/api, /assets/api, /media) to their services. Dev: http://localhost:8080 (through the gateway).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Assets' shared rules (enums, permissions, field types): its TypeScript source, like the Assets web app.
      '@eam/shared': fileURLToPath(new URL('../../services/assets/packages/shared/src/index.ts', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query', 'zod'],
  },
  server: { port: 5176, strictPort: true, host: '127.0.0.1' },
  // Built files under /static/, not Vite's default /assets/ (that is the Assets app's address space).
  build: { outDir: 'dist', assetsDir: 'static', chunkSizeWarningLimit: 1200 },
});
