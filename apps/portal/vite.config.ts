import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served at "/" on the shared FreeFounders address; the gateway sends /api/platform to the Platform API.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true },
  build: { outDir: 'dist' },
});
