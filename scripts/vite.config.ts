import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tsConfigPaths(),
  ],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    host: true, // Listen on all network interfaces
  },
  optimizeDeps: {
    exclude: [
      '@sqlite.org/sqlite-wasm',
    ],
  },
}) 