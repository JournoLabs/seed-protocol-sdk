import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts'), bin: resolve(__dirname, 'src/bin.ts') },
      formats: ['es'],
    },
    target: 'es2022',
    rollupOptions: {
      external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
      output: {
        banner: (chunk) => (chunk.name === 'bin' ? '#!/usr/bin/env node' : ''),
      },
    },
    sourcemap: true,
  },
})
