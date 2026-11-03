import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // These export from the SDK, so they run in the root NodeJS project, which has its setup.
    exclude: ['__tests__/seed/**'],
    // No network in tests (see that file).
    setupFiles: ['../sdk/__tests__/test-utils/noNetwork.node.ts'],
  },
})
