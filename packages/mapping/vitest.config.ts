import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // No network in tests (see that file).
    setupFiles: ['../sdk/__tests__/test-utils/noNetwork.node.ts'],
  },
})
