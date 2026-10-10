/** @type {import('vite').UserConfig} */

import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import { playwright } from '@vitest/browser-playwright'
import Inspect from 'vite-plugin-inspect'
import { configDefaults } from 'vitest/config'
import { seedVitePlugin } from '@seedprotocol/vite'

// import vitePlugin from './vite-plugin'
// import commonjs from '@rollup/plugin-commonjs'

// Debug logging is opt-in: `DEBUG='seedSdk:*' bun run test`. Leaving it on by default ('*') produced
// tens of thousands of log lines per run, slowing Node runs and burying failures.
const debugNamespaces = process.env.DEBUG ?? ''

// Real extra tabs for browser/multiTab.e2e.test.ts: pages opened in the test's own Playwright
// context, so they share its OPFS, Web Locks and BroadcastChannels. Each loads
// __tests__/e2e/multiTab/tab.html, which exposes `window.seedTab`.
const seedTabPages = new Map()
const seedTabCommands = {
  async openSeedTab(ctx, url) {
    const page = await ctx.context.newPage()
    page.on('pageerror', (error) => console.error('[seed tab]', error))
    await page.goto(url)
    await page.waitForFunction(() => window.seedTabReady === true)
    const id = `tab-${seedTabPages.size + 1}-${Date.now()}`
    seedTabPages.set(id, page)
    return id
  },
  async callSeedTab(ctx, id, method, ...args) {
    const page = seedTabPages.get(id)
    if (!page) throw new Error(`no seed tab ${id}`)
    return page.evaluate(([m, a]) => window.seedTab[m](...a), [method, args])
  },
  async closeSeedTab(ctx, id) {
    await seedTabPages.get(id)?.close()
    seedTabPages.delete(id)
  },
}

// Test files run in parallel. Each browser worker gets its own Playwright context (separate OPFS and
// localStorage) and each Node file runs in its own forked process with its own temp project dir, so
// files don't share storage. TEST_WORKERS overrides the per-project count; TEST_WORKERS=1 restores
// one-file-at-a-time runs for debugging order-dependent failures.
const testWorkers = (defaultCount) => {
  const n = Number.parseInt(process.env.TEST_WORKERS ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : defaultCount
}

// Workspace packages load from source, not from their gitignored dist. Their package.json exports
// point at dist, so without these aliases tests silently ran whatever was last built (a stale
// packages/react/dist hid 8 hook failures; a stale packages/eas/dist failed easPropertyCanonical).
// Regex finds match whole specifiers so `@seedprotocol/eas` doesn't also capture `@seedprotocol/eas/node`.
// `platform` picks @seedprotocol/query's entry, which (like its exports map) differs for browser and Node.
const workspaceSourceAliases = (platform) => {
  const src = (path) => resolve(__dirname, 'packages', path)
  const exact = (specifier, path) => ({
    find: new RegExp(`^${specifier.replace('/', '\\/')}$`),
    replacement: src(path),
  })
  return [
    exact('@seedprotocol/eas/node', 'eas/src/node/index.ts'),
    exact('@seedprotocol/eas', 'eas/src/index.ts'),
    exact('@seedprotocol/arweave/node', 'arweave/src/node/index.ts'),
    exact('@seedprotocol/arweave', 'arweave/src/index.ts'),
    exact('@seedprotocol/query/node', 'query/src/node/index.ts'),
    exact('@seedprotocol/query', platform === 'browser' ? 'query/src/index.ts' : 'query/src/index.node.ts'),
    exact('@seedprotocol/react', 'react/src/index.ts'),
  ]
}

// Vite's object alias form as an array, so it can be combined with workspaceSourceAliases.
const aliasEntries = (aliases) =>
  Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }))

export default defineConfig({
  plugins: [
    Inspect({
      build: true,
      outputDir: './.vite-inspect',
    }),
  ],
  server: {
    host: '127.0.0.1', // Explicitly bind to IPv4 to avoid IPv6 connection issues
  },
  test: {
    api: true, // Explicitly enable API server
    projects: [
      {
        plugins: [
          react(),
          tsConfigPaths({ projects: ['./packages/sdk/tsconfig.json'] }),
          ...seedVitePlugin({ autoInit: false, debug: false }),
        ],
        resolve: {
          alias: [
            ...workspaceSourceAliases('browser'),
            ...aliasEntries({
              '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
              '~': resolve(__dirname, 'packages/publish/src'),
              // Ensure fs modules are aliased to @zenfs/core in browser environment
              'fs': '@zenfs/core',
              'fs/promises': '@zenfs/core/promises',
              'node:fs': '@zenfs/core',
              'node:fs/promises': '@zenfs/core/promises',
            }),
          ],
        },
        optimizeDeps: {
          exclude: [
            '@sqlite.org/sqlite-wasm',
            'drizzle-orm',
            'sqlocal'
          ],
          include: [
            '@testing-library/react',
            'react',
            'react-dom',
            // Imported lazily (some through workspace sources); discovering them mid-run reloads the
            // page and fails every file in flight. Entries resolve from the repo root, so js-yaml and
            // parse5 (SDK dependencies) are root devDependencies too.
            '@tanstack/react-query',
            'arweave/bundles/web.bundle.js',
            'js-yaml',
            'parse5',
          ],
        },
        test: {
          name: 'browser',
          dir: './packages/sdk/__tests__',
          env: {
            DEBUG: debugNamespaces,
          },
          setupFiles: [
            './packages/sdk/__tests__/setup.browser.ts',
          ],
          include: [
            '**/*.test.{ts,tsx}',
          ],
          exclude: [
            ...configDefaults.exclude,
            'dist/**',
            'packages/sdk/src/node/**',
            'node/**',
            'scripts/**',
            'db/**',
            'services/**',
            'Schema/schema-models-integration.test.ts', // Node-only (reads/writes schema files with fs); runs in NodeJS
            'imports/**',
            'fromCallbackActors.test.ts',
            'validation-timeout.test.ts',
            'commonjs-compatibility.test.ts',
            'client/schemaFileInit.test.ts',
            'helpers/easDirect.test.ts',
            'feed/**',
            // Mocks global Worker; run as a Node unit test only
            'browser/db/createSqlocalDrizzle.test.ts',
          ],
          hookTimeout: 30000, // keep in sync with SETUP_HOOK_TIMEOUT_MS in test-utils/client-init.ts
          testTimeout: 30000,
          maxWorkers: testWorkers(3),
          // Both browser projects share a group so they run at the same time, after the Node group
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [
              {browser: 'chromium'}
            ],
            commands: seedTabCommands,
          },
        },
      },
      {
        plugins: [
          react(),
          tsConfigPaths({ projects: ['./packages/react/tsconfig.json', './packages/sdk/tsconfig.json'] }),
          ...seedVitePlugin({ autoInit: false, debug: false }),
        ],
        resolve: {
          alias: [
            ...workspaceSourceAliases('browser'),
            ...aliasEntries({
              '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
              'fs': '@zenfs/core',
              'fs/promises': '@zenfs/core/promises',
              'node:fs': '@zenfs/core',
              'node:fs/promises': '@zenfs/core/promises',
            }),
          ],
        },
        optimizeDeps: {
          exclude: [
            '@sqlite.org/sqlite-wasm',
            'drizzle-orm',
            'sqlocal',
          ],
          include: [
            '@testing-library/react',
            'react',
            'react-dom',
            // Imported lazily (some through workspace sources); discovering them mid-run reloads the
            // page and fails every file in flight. Entries resolve from the repo root, so js-yaml and
            // parse5 (SDK dependencies) are root devDependencies too.
            '@tanstack/react-query',
            'arweave/bundles/web.bundle.js',
            'js-yaml',
            'parse5',
          ],
        },
        test: {
          name: 'browser-react',
          dir: './packages/react/__tests__',
          env: {
            DEBUG: debugNamespaces,
          },
          setupFiles: [
            './packages/react/__tests__/setup.browser.ts',
          ],
          include: [
            '**/*.test.{ts,tsx}',
          ],
          exclude: [
            ...configDefaults.exclude,
            'dist/**',
          ],
          hookTimeout: 30000, // keep in sync with SETUP_HOOK_TIMEOUT_MS in test-utils/client-init.ts
          testTimeout: 30000,
          maxWorkers: testWorkers(3),
          // Both browser projects share a group so they run at the same time, after the Node group
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      },
      {
        plugins: [
          tsConfigPaths({
            projects: [
              './packages/sdk/tsconfig.json',
              './packages/feed/tsconfig.json',
              './packages/publish/tsconfig.json',
              './packages/react/tsconfig.json',
            ],
          }),
        ],
        resolve: {
          alias: [
            ...workspaceSourceAliases('node'),
            ...aliasEntries({
              '~': resolve(__dirname, 'packages/publish/src'),
              '@seedprotocol/feed': resolve(__dirname, 'packages/feed/src/index.ts'),
              '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
            }),
          ],
        },
        test: {
          name: 'NodeJS',
          environment: 'node',
          dir: '.',
          env: {
            DEBUG: debugNamespaces,
          },
          setupFiles: [],
          include: [
            'packages/sdk/__tests__/**/*.test.ts',
            'packages/feed/__tests__/**/*.test.ts',
            'packages/mapping/__tests__/**/*.test.ts',
            // Other publish tests use bun:test and run via `bun run --filter @seedprotocol/publish test`.
            'packages/publish/src/services/publish/actors/createArweaveDataItemsPhase2.test.ts',
            'packages/publish/src/services/publish/helpers/getPublishUploadData.test.ts',
            'packages/react/__tests__/**/*.node.test.tsx',
          ],
          // Paths are relative to `dir: '.'` (the repo root). The old `node/**`-style patterns were written for
          // dir './packages/sdk/__tests__' and silently stopped matching when dir changed in v0.4.21.
          exclude: [
            ...configDefaults.exclude,
            '**/node_modules/**',
            'dist/**',

            // Browser-only: SQL-tag liveQuery isn't supported by the Node stub. Runs in the `browser` project.
            'packages/sdk/__tests__/browser/db/Db.test.ts',
            // Browser-only: needs real OPFS and Workers. Runs in the `browser` project.
            'packages/sdk/__tests__/browser/helpers/opfsLockedMount.test.ts',
            'packages/sdk/__tests__/browser/db/concurrentPrepareDb.test.ts',
            'packages/sdk/__tests__/browser/helpers/tabCoordinator.test.ts',
            'packages/sdk/__tests__/browser/helpers/tabEvents.test.ts',
            'packages/sdk/__tests__/browser/multiTab.e2e.test.ts',
          ],
          hookTimeout: 30000, // keep in sync with SETUP_HOOK_TIMEOUT_MS in test-utils/client-init.ts
          testTimeout: 30000,
          pool: 'forks',
          maxWorkers: testWorkers(4),
          sequence: { groupOrder: 0 },
          // Several files vi.mock core modules (@/helpers/environment, BaseDb, BaseFileManager). With
          // isolate: false those mocks and the shared client leaked into later files, and every DB-backed
          // suite after them failed in beforeAll ("Seed Protocol schema not found").
          isolate: true,
        },
      },
      // {
      //   plugins: [
      //     tsConfigPaths(),
      //   ],
      //   test: {
      //     name: 'CLI',
      //     environment: 'node',
      //     globalSetup: './vitest.setup.ts',
      //     dir: './__tests__/cli',
      //     env: {
      //       DEBUG: '*',
      //     },
      //     setupFiles: [
      //       './__tests__/setup.ts',
      //     ],
      //     exclude: [ 
      //       '**/node_modules/**', 
      //       'dist/**', 
      //       'src/browser/**', 
      //     ],
      //     testTimeout: 120000,
      //   },
      // },
    ],
  },
  // SDK build lives in packages/sdk (uses Rollup)
})

// export default defineConfig(async () => {
//   return {
//     // envDir: './',
//     // plugins: [
//     //   tsConfigPaths(),
//     //   viteStaticCopy({
//     //     targets: [
//     //       { src: 'src/db/seedSchema', dest: 'dist/db' },
//     //       { src: 'src/db/configs', dest: 'dist/shared' },
//     //       { src: 'src/seedSchema', dest: 'dist' },
//     //       {
//     //         src: 'src/node/codegen/templates/**/*',
//     //         dest: 'dist/node/codegen/templates',
//     //       },
//     //     ],
//     //   }),
//     // ],
//     build: {
//       lib: [
//         {
//           entry: resolve(__dirname, 'src/index.ts'),
//           name: 'Seed Protocol SDK',
//         //   fileName: (format) => {
//         //     if (format === 'cjs') {
//         //       return 'main.cjs'
//         //     }
//         //     return 'main.js'
//         //   },
//         },
//       ],
//       rollupOptions: {
//         input: {
//           main: 'src/index.ts',
//           bin: 'scripts/bin.ts',
//         },
//         output: [
//           {
//             dir: 'dist',
//             format: 'esm',
//             sourcemap: true,
//           },
//         ],
//         external: [
//           'drizzle-orm',
//           'path-browserify',
//           '@zenfs/core',
//           '@zenfs/dom',
//           'arweave',
//           'tslib',
//           'better-sqlite3',
//         ],
//         plugins: [
//           typescript({
//             include: [
//               'src/index.ts',
//               'src/client.ts',
//               'src/eventBus.ts',
//               'scripts/bin.ts',
//               'src/seed.ts',
//               'src/types/**/*.ts',
//               'src/init.ts',
//               'src/browser/**/*.ts',
//               'src/node/**/*.ts',
//               'src/shared/**/*.ts',
//               'src/db/**/*.ts',
//               'src/helpers/**/*.ts',
//               'src/interfaces/**/*.ts',
//               'src/Item/**/*.ts',
//               'src/ItemProperty/**/*.ts',
//               'src/schema/**/*.ts',
//               'src/seedSchema/**/*.ts',
//               'src/stores/**/*.ts',
//               'src/services/**/*.ts',
//               'src/events/**/*.ts',
//               'src/graphql/**/*.ts',
//             ],
//           }),
//           tsConfigPaths(),
//           commonjs(),
//         ],
//       },
//     },
//     // build: {
//     //   lib: {
//     //     entry: 'src/browser/index.ts',
//     //     name: 'Seed Protocol SDK',
//     //     fileName: (format) => {
//     //       if (format === 'cjs') {
//     //         return 'main.cjs'
//     //       }
//     //       return 'main.js'
//     //     },
//     //     formats: ['es', 'cjs'],
//     //   },
//     //   rollupOptions: {
//     //     external: ['@sqlite.org/sqlite-wasm'],
//     //     output: {
//     //       globals: {
//     //         '@sqlite.org/sqlite-wasm': 'sqlite3InitModule',
//     //       },
//     //     },
//     //   },
//     // },
//     // test: {},
//     // resolve: {
//     //   alias: [
//     //     { find: '@', replacement: path.resolve(__dirname, 'src') },
//     //     { find: '@@', replacement: path.resolve(__dirname) },
//     //   ],
//     // },
//   }
// })
