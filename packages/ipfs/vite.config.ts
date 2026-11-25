import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es'],
    },
    target: 'es2022',
    rollupOptions: {
      // Keep class and function names in the built output: a log line or a `.name` read shows the real name.
      output: { keepNames: true },
      external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    },
    sourcemap: true,
  },
})
