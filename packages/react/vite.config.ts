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
      output: {
        // Every export is browser-only (hooks, providers, OPFS components). The directive
        // lets React Server Components frameworks (Next.js App Router) import SeedProvider
        // from a server component such as app/layout.tsx without a client wrapper file.
        banner: "'use client';",
      },
    },
    sourcemap: true,
  },
})
