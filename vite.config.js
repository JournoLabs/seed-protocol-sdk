/** @type {import('vite').UserConfig} */

import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
// import { viteStaticCopy } from 'vite-plugin-static-copy'
// import { apiRoutes } from './vite/plugin/api'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
// import { dts } from 'rollup-plugin-dts'
import { playwright } from '@vitest/browser-playwright'
import Inspect from 'vite-plugin-inspect'
import { configDefaults } from 'vitest/config'
import { seedVitePlugin } from './packages/sdk/src/vite'

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
          nodePolyfills({
            exclude: ['readline', 'readline/promises', 'fs', 'fs/promises', 'node:fs', 'node:fs/promises'],
            include: ['crypto', 'stream', 'util', 'path',],
            globals: {
              Buffer: true,
              global: true,
              process: true,
            },
            protocolImports: true,
          }),
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
            // Ensure path modules are aliased to path-browserify in browser environment
            'path': 'path-browserify',
            'node:path': 'path-browserify',
          },
        },
        optimizeDeps: {
          exclude: [
            '@sqlite.org/sqlite-wasm',
            '@seedprotocol/cli',
            'drizzle-kit',
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
          nodePolyfills({
            exclude: ['readline', 'readline/promises', 'fs', 'fs/promises', 'node:fs', 'node:fs/promises'],
            include: ['crypto', 'stream', 'util', 'path'],
            globals: {
              Buffer: true,
              global: true,
              process: true,
            },
            protocolImports: true,
          }),
        ],
        resolve: {
          alias: {
            '@seedprotocol/sdk': resolve(__dirname, 'packages/sdk/src'),
            'fs': '@zenfs/core',
            'fs/promises': '@zenfs/core/promises',
            'node:fs': '@zenfs/core',
            'node:fs/promises': '@zenfs/core/promises',
            'path': 'path-browserify',
            'node:path': 'path-browserify',
          },
        },
        optimizeDeps: {
          exclude: [
            '@sqlite.org/sqlite-wasm',
            'drizzle-kit',
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
            'packages/publish/src/**/*.test.ts',
            'packages/react/__tests__/**/*.node.test.tsx',
          ],
          exclude: [
            ...configDefaults.exclude,
            '**/node_modules/**',
            'dist/**',
            'packages/sdk/src/browser/**',
            'browser/**',
            'node/**',
            'scripts/**',
            'db/**',
            'services/**',
            'Schema/schema-models-integration.test.ts',
            'imports/**',
            'fromCallbackActors.test.ts',
            'validation-timeout.test.ts',
            'commonjs-compatibility.test.ts',
          ],
          testTimeout: 30000,
          pool: 'forks',
          maxWorkers: 1,
          isolate: false,
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
