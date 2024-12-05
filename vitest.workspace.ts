import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    extends: './vite.config.js',
    test: {
      name: 'browser',
      environment: 'jsdom',
      globalSetup: './vitest.setup.mts',
      setupFiles: ['./__tests__/setup.ts'],
      exclude: [
        '**/node_modules/**',
        'dist/**',
        'src/node/**',
        'src/index.ts',
        '__tests__/shared/**',
        '__tests__/fs/**',
        '__tests__/node/**',
        '__tests__/scrips/**',
      ],
      pool: 'forks',
      hookTimeout: 60000,
      // browser: {
      //   provider: 'playwright',
      //   enabled: true,
      //   name: 'chromium',
      // },
    },
  },
  {
    extends: './vite.config.js',
    test: {
      name: 'SDK',
      environment: 'node',
      exclude: ['**/node_modules/**', 'dist/**', 'src/browser/**'],
    },
  },
])
