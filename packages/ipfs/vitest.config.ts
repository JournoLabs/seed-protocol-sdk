import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // No network in tests (see that file). The pinning tests run their servers on 127.0.0.1.
    setupFiles: ['../sdk/__tests__/test-utils/noNetwork.node.ts'],
  },
})
