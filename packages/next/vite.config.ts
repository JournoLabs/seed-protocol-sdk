import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
