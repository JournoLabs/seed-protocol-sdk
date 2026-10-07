import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Same runtime shim as the build (vite.config.ts): codegen imports these types as values.
      '@graphql-typed-document-node/core': resolve(__dirname, 'src/shims/typed-document-node.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
})
