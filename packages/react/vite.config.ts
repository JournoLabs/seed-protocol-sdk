import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      rollupTypes: false,
      insertTypesEntry: true,
      skipDiagnostics: true,
    }),
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    target: 'es2020',
    rollupOptions: {
      external: (id) =>
        id === '@seedprotocol/sdk' ||
        id === 'react' ||
        id === 'react-dom' ||
        id === 'react/jsx-runtime' ||
        id.startsWith('@tanstack/') ||
        (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')),
    },
    sourcemap: true,
  },
})
