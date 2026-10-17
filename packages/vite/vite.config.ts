import { defineConfig } from 'vite'
import { resolve } from 'path'
import { cpSync, mkdirSync } from 'node:fs'

export default defineConfig({
  plugins: [
    {
      name: 'copy-vite-shims',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true })
        cpSync(resolve(__dirname, 'src/stream-default-shim.js'), resolve(__dirname, 'dist/stream-default-shim.js'))
      },
    },
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    target: 'node20',
    rollupOptions: {
      // Bare imports stay external, except the private bundler-core, which is inlined.
      external: (id) =>
        id !== '@seedprotocol/bundler-core' &&
        !id.startsWith('.') &&
        !id.startsWith('/') &&
        !id.startsWith('\0'),
    },
    sourcemap: true,
  },
})
