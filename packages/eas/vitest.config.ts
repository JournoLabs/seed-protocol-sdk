import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      // graphql-codegen output imports type-only symbols as values; the package has no runtime entry.
      '@graphql-typed-document-node/core': resolve(__dirname, 'src/shims/typed-document-node.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
})
