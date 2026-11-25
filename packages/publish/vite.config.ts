import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: 'src/index.ts',
        thirdweb: 'src/thirdweb.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: 'node20',
    rollupOptions: {
      // Keep class and function names in the built output: a log line or a `.name` read shows the real name.
      output: { keepNames: true },
      external: (id) =>
        id === '@seedprotocol/sdk' ||
        id === '@seedprotocol/react' ||
        id === 'thirdweb' ||
        id.startsWith('thirdweb/') ||
        (!id.startsWith('.') &&
          !id.startsWith('/') &&
          !id.startsWith('\0') &&
          !id.startsWith('~/')),
    },
    sourcemap: true,
  },
})
