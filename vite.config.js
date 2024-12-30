/** @type {import('vite').UserConfig} */

import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { apiRoutes } from './vite/plugin/api'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import react from '@vitejs/plugin-react'
// import { viteStaticCopy } from 'vite-plugin-static-copy'
// import tsConfigPaths from 'vite-tsconfig-paths'
// import { dts } from 'rollup-plugin-dts'

export default defineConfig(async () => {
  return {
    envDir: './',
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm',],
    },
    plugins: [
      nodePolyfills({
        include: ['crypto', 'util', 'stream'],
      }),
      tsConfigPaths(),
      apiRoutes(),
      react(),
    ],
    resolve: {
      alias: {
        fs: '@zenfs/core',
        'node:fs': '@zenfs/core',
        'node:path': 'path-browserify',
        path: 'path-browserify',
      },
    },
    build: {
      lib: [
        {
          entry: {
            main: 'src/index.ts',
            bin: 'scripts/bin.ts',
          },
          name: 'Seed Protocol SDK',
          fileName: (format) => {
            if (format === 'cjs') {
              return 'main.cjs'
            }
            return 'main.js'
          },
        },
        // {
        //   input: 'scripts/bin.ts',
        // },
      ],
      rollupOptions: {
        external: [
          'drizzle-orm',
          'path-browserify',
          '@zenfs/core',
          '@zenfs/dom',
          'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
          'chromium-bidi/lib/cjs/cdp/CdpConnection',
          'better-sqlite3',
        ],
        output: [
          {
            dir: 'dist_test',
            format: 'esm',
            sourcemap: true,
          },
        ],
      },
    },
    // plugins: [
    //   // dts({
    //   //   entryRoot: 'src/browser',
    //   // }),
    //   tsConfigPaths(),
    //   viteStaticCopy({
    //     targets: [
    //       { src: 'src/db/seedSchema', dest: 'browser/db' },
    //       {
    //         src: 'src/db/browser.seed.db.config.ts',
    //         dest: 'browser/db',
    //       },
    //       {
    //         src: 'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm',
    //         dest: 'browser',
    //       },
    //       {
    //         src: 'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-worker1-bundler-friendly.mjs',
    //         dest: 'browser',
    //       },
    //       {
    //         src: 'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-bundler-friendly.mjs',
    //         dest: 'browser',
    //       },
    //       {
    //         src: 'node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3-opfs-async-proxy.js',
    //         dest: 'browser',
    //       },
    //     ],
    //   }),
    // ],
    // build: {
    //   lib: {
    //     entry: 'src/browser/index.ts',
    //     name: 'Seed Protocol SDK',
    //     fileName: (format) => {
    //       if (format === 'cjs') {
    //         return 'main.cjs'
    //       }
    //       return 'main.js'
    //     },
    //     formats: ['es', 'cjs'],
    //   },
    //   rollupOptions: {
    //     external: ['@sqlite.org/sqlite-wasm'],
    //     output: {
    //       globals: {
    //         '@sqlite.org/sqlite-wasm': 'sqlite3InitModule',
    //       },
    //     },
    //   },
    // },
    // test: {},
    // resolve: {
    //   alias: [
    //     { find: '@', replacement: path.resolve(__dirname, 'src') },
    //     { find: '@@', replacement: path.resolve(__dirname) },
    //   ],
    // },
  }
})
