import { defineWorkspace } from 'vitest/config'
import tsConfigPaths       from 'vite-tsconfig-paths'

export default defineWorkspace([
  {
    plugins: [
      tsConfigPaths(),
    ],
    optimizeDeps: {
      exclude: [
        '@sqlite.org/sqlite-wasm',
      ],
    },
    test: {
      name: 'browser',
      environment: 'jsdom',
      globalSetup: './vitest.setup.mts',
      dir: './__tests__/',
      setupFiles: [ './__tests__/setup.ts' ],
      exclude: [
        '**/node_modules/**',
        'dist/**',
        'src/node/**',
      ],
      pool: 'forks',
      hookTimeout: 60000,
      browser: {
        enabled: true,
        name: 'chromium',
        provider: 'playwright',
        // https://playwright.dev
        providerOptions: {},
      },
    },
  },
  {
    plugins: [
      tsConfigPaths(),
    ],
    test: {
      name: 'NodeJS',
      environment: 'node',
      globalSetup: './vitest.setup.mts',
      dir: './__tests__/',
      setupFiles: [
        './__tests__/node/setup.ts',
      ],
      exclude: [ '**/node_modules/**', 'dist/**', 'src/browser/**' ],
      hookTimeout: 60000,
    },
  },
])
