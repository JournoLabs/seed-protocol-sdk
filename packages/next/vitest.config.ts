import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Load the private bundler-core from source, so tests don't depend on its dist.
    alias: {
      '@seedprotocol/bundler-core': fileURLToPath(new URL('../bundler-core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
})
