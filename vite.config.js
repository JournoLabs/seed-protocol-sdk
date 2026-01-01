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
// import typescript from '@rollup/plugin-typescript'
import rollupTsConfigPaths from 'rollup-plugin-tsconfig-paths'
import copy from 'rollup-plugin-copy'
import Inspect from 'vite-plugin-inspect'
import { configDefaults } from 'vitest/config'
import { seedVitePlugin } from './src/vite'

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
          tsConfigPaths(),
          ...seedVitePlugin({ autoInit: false, debug: false }),
          nodePolyfills({
            exclude: ['readline', 'readline/promises', 'fs', 'fs/promises', 'node:fs', 'node:fs/promises'],
            // Include crypto, stream, and util - crypto polyfill needs stream.Transform and util
            include: ['crypto', 'stream', 'util'],
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
            '@seedprotocol/sdk': resolve(__dirname, 'src'),
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
          dir: './__tests__',
          env: {
            DEBUG: '*',
          },
          setupFiles: [ 
            './__tests__/setup.ts',
            './__tests__/setup.browser.ts',
          ],
          exclude: [
            ...configDefaults.exclude,
            'dist/**',
            'src/node/**',
            '__tests__/node/**',
            '__tests__/schema/**',
            '__tests__/scripts/**',
            '__tests__/db/**',
          ],
          hookTimeout: 60000,
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
          tsConfigPaths(),
        ],
        optimizeDeps: {
          exclude: [
            '@seedprotocol/cli',
          ],
        },
        test: {
          name: 'NodeJS',
          environment: 'node',
          // globalSetup: './vitest.setup.ts',
          dir: './__tests__',
          env: {
            DEBUG: '*',
          },
          setupFiles: [
            './__tests__/setup.ts',
          ],
          include: [
            '__tests__/**/*.test.{ts,tsx}',
          ],
          exclude: [ 
            '**/node_modules/**', 
            'dist/**', 
            'src/browser/**', 
            '__tests__/browser/**',
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
  build: {
    lib: {
      entry: {
        main: resolve(__dirname, 'src/index.ts'),
      },
      name: 'Seed Protocol SDK',
    },

    target: 'node18',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'src/index.ts',
      },
      output: [
        {
          dir: 'dist',
          format: 'esm',
          entryFileNames: '[name].js',
        },
      ],
      plugins: [
        rollupTsConfigPaths(),
        copy({
          targets: [
            { src: 'src/**/*.ts', dest: 'dist/src' },
            { src: 'src/db/seedSchema', dest: 'dist/db' },
            { src: 'src/seedSchema', dest: 'dist' },
            {
              src: 'src/node/codegen/templates/**/*',
              dest: 'dist/node/codegen/templates',
            },
          ],
          hook: 'writeBundle',
        }),
      ],
      external: [
        'drizzle-orm',
        'path-browserify',
        '@zenfs/core',
        '@zenfs/dom',
        'arweave',
        'tslib',
        'better-sqlite3',
        '@tanstack/react-query',
        '@sqlite.org/sqlite-wasm',
        'eventemitter3',
        'node:fs',
        'node:path',
        'node:events',
        'fs',
        'fs/promises',
        'node:string_decoder',
        'node:fs/promises',
        'node:url',
        'node:util',
        'node:stream',
        'node:buffer',
        'node:process',
        'node:os',
        'node:crypto',
        'node:http',
        'node:https',
        'path',
        'url',
        'util',
        'stream',
        'buffer',
        'process',
        'os',
        'crypto',
        'http',
        'https',
        'child_process',
        'nunjucks',
        'node:child_process',
      ],
    },
    // resolve: {
    //   alias: {
    //     'node:fs': '@zenfs/core',
    //   },
    // },
  },
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
