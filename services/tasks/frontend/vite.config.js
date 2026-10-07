import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One id per build. It is baked into the code AND written to /version.json,
// so a running app (the Android app above all) can tell when a newer build
// has been deployed and reload itself -- see src/autoUpdate.js.
const BUILD_ID = String(Date.now())

const versionFile = {
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
  },
}

export default defineConfig({
  plugins: [react(), versionFile],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
})
