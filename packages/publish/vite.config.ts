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
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    target: 'node20',
    rollupOptions: {
      external: (id) =>
        id === '@seedprotocol/sdk' ||
        (!id.startsWith('.') &&
          !id.startsWith('/') &&
          !id.startsWith('\0') &&
          !id.startsWith('~/')),
    },
    sourcemap: true,
  },
})
