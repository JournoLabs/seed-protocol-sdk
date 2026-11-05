import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        node: resolve(__dirname, 'src/node/index.ts'),
        verify: resolve(__dirname, 'src/verify.ts'),
        seed: resolve(__dirname, 'src/seed/index.ts'),
      },
      formats: ['es'],
    },
    target: 'es2022',
    rollupOptions: {
      external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    },
    sourcemap: true,
  },
})
