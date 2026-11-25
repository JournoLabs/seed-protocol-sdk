import { defineConfig } from 'vite'
import { resolve } from 'path'

const typedDocumentNodeShim = resolve(__dirname, 'src/shims/typed-document-node.js')

export default defineConfig({
  resolve: {
    alias: {
      '@graphql-typed-document-node/core': typedDocumentNodeShim,
    },
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        node: resolve(__dirname, 'src/node/index.ts'),
      },
      formats: ['es'],
    },
    target: 'node20',
    rollupOptions: {
      // Keep class and function names in the built output: a log line or a `.name` read shows the real name.
      output: { keepNames: true },
      external: (id) => {
        if (
          id === '@graphql-typed-document-node/core' ||
          id === typedDocumentNodeShim ||
          id.includes('shims/typed-document-node')
        ) {
          return false
        }
        return !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')
      },
    },
    sourcemap: true,
  },
})
