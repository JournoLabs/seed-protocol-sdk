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
          alias: {
            '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
            '~': resolve(__dirname, 'packages/publish/src'),
            // Ensure fs modules are aliased to @zenfs/core in browser environment
            'fs': '@zenfs/core',
            'fs/promises': '@zenfs/core/promises',
            'node:fs': '@zenfs/core',
            'node:fs/promises': '@zenfs/core/promises',
          },
        },
        optimizeDeps: {
          exclude: [
            '@sqlite.org/sqlite-wasm',
            '@seedprotocol/cli',
            'drizzle-orm',
            'sqlocal'
          ],
          include: [
            '@testing-library/react',
            'react',
            'react-dom',
          ],
        },
        test: {
          name: 'browser',
          dir: './packages/sdk/__tests__',
          env: {
            DEBUG: '*',
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
            'Schema/schema-models-integration.test.ts',
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
          hookTimeout: 90000,
          testTimeout: 30000,
          maxWorkers: 1,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [
              {browser: 'chromium'}
            ],
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
          alias: {
            '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
            'fs': '@zenfs/core',
            'fs/promises': '@zenfs/core/promises',
            'node:fs': '@zenfs/core',
            'node:fs/promises': '@zenfs/core/promises',
          },
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
          ],
        },
        test: {
          name: 'browser-react',
          dir: './packages/react/__tests__',
          env: {
            DEBUG: '*',
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
          hookTimeout: 90000,
          testTimeout: 30000,
          maxWorkers: 1,
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
          alias: {
            '~': resolve(__dirname, 'packages/publish/src'),
            '@seedprotocol/feed': resolve(__dirname, 'packages/feed/src/index.ts'),
            '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
          },
        },
        optimizeDeps: {
          exclude: [
            '@seedprotocol/cli',
          ],
        },
        test: {
          name: 'NodeJS',
          environment: 'node',
          dir: '.',
          env: {
            DEBUG: '*',
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

            // Side effects: npm install / npx seed init / npm run build, rewrite tracked mock files, and leave
            // the process cwd in a deleted temp dir — with isolate: false that breaks every later file.
            'packages/sdk/__tests__/scripts/integration.test.ts',
            'packages/sdk/__tests__/node/client.test.ts',

            // Browser-only: SQL-tag liveQuery isn't supported by the Node stub. Runs in the `browser` project.
            'packages/sdk/__tests__/browser/db/Db.test.ts',

            // Known broken — stale against current code. Fix or delete each, then drop it from this list.
            'packages/sdk/__tests__/commonjs-compatibility.test.ts', // expects dist/main.cjs.js; bare require in ESM
            'packages/sdk/__tests__/db/liveQuery.test.ts', // liveQuery expectations fail in Node and browser
            'packages/sdk/__tests__/events/files/download.test.ts', // @/helpers mock lacks BaseArweaveClient.getBaseUrl
            'packages/sdk/__tests__/fromCallbackActors.test.ts', // walks process.cwd()/src, which doesn't exist at repo root
            'packages/sdk/__tests__/imports/processMarkdownFrontmatter.test.ts', // saveModelsFromMarkdown tests never configure the Db
            'packages/sdk/__tests__/Model/pendingWrites.test.ts', // cleanup deletes models before FK-dependent rows
            'packages/sdk/__tests__/node/FileManager.test.ts', // static FileManager.initializeFileSystem() no longer exists
            'packages/sdk/__tests__/node/PathResolver.test.ts', // chdirs into mock dirs that don't exist
            'packages/sdk/__tests__/node/PathResolver.production.test.ts', // assumes NODE_ENV=production and a built dist/
            'packages/sdk/__tests__/Schema/schema-models-integration.test.ts', // mkdirs '/app-files' (browser path)
            'packages/sdk/__tests__/scripts/codegen.test.ts', // reads process.cwd()/src/seedSchema
            'packages/sdk/__tests__/scripts/production-path.test.ts', // imports removed @/node/PathResolver
            'packages/sdk/__tests__/services/write/writeProcessMachine.test.ts', // cleanup deletes models before FK-dependent rows
            'packages/sdk/__tests__/validation-timeout.test.ts', // same FK-violating cleanup
          ],
          testTimeout: 30000,
          pool: 'forks',
          maxWorkers: 1,
          // Several files vi.mock core modules (@/helpers/environment, BaseDb, BaseFileManager). With
          // isolate: false those mocks and the shared client leaked into later files, and every DB-backed
          // suite after them failed in beforeAll ("Seed Protocol schema not found").
          isolate: true,
          fileParallelism: false,
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
