import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    target: 'node20',
    rollupOptions: {
      external: (id) =>
        id === '@seedprotocol/sdk' ||
        !id.startsWith('.') &&
        !id.startsWith('/') &&
        !id.startsWith('\0'),
    },
    sourcemap: true,
  },
})
