import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Workspace packages load from source, not from their gitignored dist (as in the root vite.config.js),
// so tests run without building them first and never run a stale build.
const src = (path: string) => resolve(__dirname, '..', path)

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@seedprotocol\/eas$/, replacement: src('eas/src/index.ts') },
      { find: /^@seedprotocol\/arweave$/, replacement: src('arweave/src/index.ts') },
      // @seedprotocol/eas's codegen imports these types as values (see packages/eas/vitest.config.ts)
      { find: '@graphql-typed-document-node/core', replacement: src('eas/src/shims/typed-document-node.js') },
    ],
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
})
