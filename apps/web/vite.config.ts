import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// One id per build: the saved query cache (PLAN.md §19.18) is dropped when it changes, so a new deploy never reads
// data saved in an older shape.
const BUILD_ID = process.env.FF_BUILD_ID || new Date().toISOString().replace(/\D/g, '').slice(0, 14);

// The Kaampilot web app (PLAN.md §18). Served at "/" on the shared address; the gateway sends the APIs
// (/api/platform, /tasks/api, /assets/api, /media) to their services. Dev: http://localhost:8080 (through the gateway).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The app's files stay on the phone (PLAN.md §19.18): a service worker built from sw/sw.js, production builds only
    // (registered by src/lib/sw-register.ts). It precaches index.html + /static/*; it never touches the API paths.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'sw',
      filename: 'sw.js',
      injectRegister: false,
      manifest: false,
      devOptions: { enabled: false },
      injectManifest: {
        // Fonts: the Latin files only (the other scripts' files load on demand if ever needed).
        globPatterns: ['index.html', 'theme.js', 'favicon.svg', 'static/**/*.{js,css}', 'static/**/*-latin-{500,600,wght}-*.woff2'],
        // The old Tasks app's kill-switch must always come from the network.
        globIgnores: ['tasks/**', 'sw.js'],
        // The largest chunk (the QR scanner) is ~450 KB; anything bigger than this is a mistake worth noticing.
        maximumFileSizeToCacheInBytes: 1_500_000,
      },
    }),
  ],
  define: { __FF_BUILD_ID__: JSON.stringify(BUILD_ID) },
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
