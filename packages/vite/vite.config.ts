import { defineConfig } from 'vite'
import { resolve } from 'path'
import { cpSync, mkdirSync } from 'node:fs'

export default defineConfig({
  plugins: [
    {
      name: 'copy-vite-shims',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true })
        for (const file of ['debug-default-shim.js', 'arweave-default-shim.js']) {
          cpSync(resolve(__dirname, 'src', file), resolve(__dirname, 'dist', file))
        }
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
      external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    },
    sourcemap: true,
  },
})
