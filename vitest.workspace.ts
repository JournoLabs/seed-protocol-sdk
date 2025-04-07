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
      globalSetup: './vitest.setup.ts',
      dir: './__tests__/',
      setupFiles: [ './__tests__/setup.ts' ],
      exclude: [
        '**/node_modules/**',
        'dist/**',
        'src/node/**',
        '__tests__/node/**',
        '__tests__/bin/**',
        '__tests__/schema/**',
        '__tests__/scripts/**',
      ],
      pool: 'forks',
      hookTimeout: 60000,
      browser: {
        enabled: true,
        name: 'chromium',
        provider: 'playwright',
        // https://playwright.dev
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
      globalSetup: './vitest.setup.ts',
      dir: './__tests__/',
      setupFiles: [
        './__tests__/setup.ts',
      ],
      exclude: [ '**/node_modules/**', 'dist/**', 'src/browser/**', '__tests__/browser/**', '__tests__/bin/**' ],
    },
  },
  {
    plugins: [
      tsConfigPaths(),
    ],
    test: {
      name: 'CLI',
      environment: 'node',
      dir: './__tests__/',
      exclude: [ '**/node_modules/**', 'dist/**', 'src/browser/**', '__tests__/browser/**', '__tests__/node/**' ],
    },
  },
])
