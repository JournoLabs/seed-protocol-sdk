/** @type {import('vite').UserConfig} */

import { defineConfig } from 'vite'
import { resolve } from 'node:path'
// import { viteStaticCopy } from 'vite-plugin-static-copy'
// import { apiRoutes } from './vite/plugin/api'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
// import react from '@vitejs/plugin-react'
// import tsConfigPaths from 'vite-tsconfig-paths'
// import { dts } from 'rollup-plugin-dts'

// import typescript from '@rollup/plugin-typescript'
import tsConfigPaths from 'rollup-plugin-tsconfig-paths'
import copy from 'rollup-plugin-copy'
import Inspect from 'vite-plugin-inspect'
// import vitePlugin from './vite-plugin'
// import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  plugins: [
    Inspect({
      build: true,
      outputDir: './.vite-inspect',
    }),
  ],
  build: {
    lib: {
      entry: {
        main: resolve(__dirname, 'src/index.ts'),
        bin: resolve(__dirname, 'scripts/bin.ts'),
      },
      name: 'Seed Protocol SDK',
    },

    target: 'node18',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'src/index.ts',
        bin: 'scripts/bin.ts',
      },
      output: [
        {
          dir: 'dist',
          format: 'esm',
          entryFileNames: '[name].js',
        },
      ],
      plugins: [
        tsConfigPaths(),
        copy({
          targets: [
            { src: 'src/**/*.ts', dest: 'dist/src' },
            { src: 'src/db/seedSchema', dest: 'dist/db' },
            { src: 'src/db/configs', dest: 'dist/shared' },
            { src: 'src/seedSchema', dest: 'dist' },
            {
              src: 'src/node/codegen/templates/**/*',
              dest: 'dist/node/codegen/templates',
            },
            {
              src: 'src/node/db/node.app.db.config.ts',
              dest: 'dist/node/db',
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
//     //       {
//     //         src: 'src/node/db/node.app.db.config.ts',
//     //         dest: 'dist/node/db',
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
