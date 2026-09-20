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
        react: 'src/react.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: 'esnext',
    rollupOptions: {
      external: (id) =>
        id === 'react' ||
        id === 'react-dom' ||
        id === 'react/jsx-runtime' ||
        id === 'rss-parser' ||
        (!id.startsWith('.') &&
          !id.startsWith('/') &&
          !id.startsWith('\0') &&
          !id.startsWith('~/')),
    },
    sourcemap: true,
  },
})
