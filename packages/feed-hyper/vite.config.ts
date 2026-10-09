import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: { index: 'src/index.ts', bin: 'src/bin.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: 'node20',
    rollupOptions: {
      external: (id) =>
        id === '@seedprotocol/sdk' ||
        id === '@seedprotocol/feed' ||
        (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')),
      output: {
        banner: (chunk) => (chunk.name === 'bin' ? '#!/usr/bin/env node' : ''),
      },
    },
    sourcemap: true,
  },
})
