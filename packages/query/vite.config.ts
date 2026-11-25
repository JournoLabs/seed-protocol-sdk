import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'index.node': resolve(__dirname, 'src/index.node.ts'),
        node: resolve(__dirname, 'src/node/index.ts'),
        ens: resolve(__dirname, 'src/ens/index.ts'),
      },
      formats: ['es'],
    },
    target: 'node20',
    rollupOptions: {
      // Keep class and function names in the built output: a log line or a `.name` read shows the real name.
      output: { keepNames: true },
      external: (id) =>
        !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
    },
    sourcemap: true,
  },
})
