import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      environment: 'jsdom',
      globalSetup: './vitest.setup.mts',
      setupFiles: ['./__tests__/setup.ts'],
      exclude: ['**/node_modules/**', 'dist/**'],
      pool: 'forks',
      hookTimeout: 60000,
      browser: {
        enabled: true,
        name: 'arc',
      },
    },
  },
  {
    test: {
      environment: 'node',
      exclude: ['**/node_modules/**', 'dist/**', 'src/browser/**'],
    },
  },
])
