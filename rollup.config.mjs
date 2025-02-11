import typescript from '@rollup/plugin-typescript'
import { execSync } from 'node:child_process'
import copy from 'rollup-plugin-copy'
import tsConfigPaths from 'rollup-plugin-tsconfig-paths'
import commonjs from '@rollup/plugin-commonjs'
// import nodeResolve from '@rollup/plugin-node-resolve'
// import webWorkerLoader from 'rollup-plugin-web-worker-loader'
// import polyfillNode from 'rollup-plugin-polyfill-node'

const postProcess = () => {
  return {
    name: 'post-process',
    writeBundle() {
      execSync('chmod +x dist/bin.js')
    },
  }
}

const config = [
  {
    input: {
      main: 'src/index.ts',
      bin: 'scripts/bin.ts',
    },
    output: [
      {
        dir: 'dist',
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: [
      'drizzle-orm',
      'path-browserify',
      '@zenfs/core',
      '@zenfs/dom',
      'arweave',
      'tslib',
      'better-sqlite3',
    ],
    plugins: [
      typescript({
        include: [
          'src/index.ts',
          'src/client.ts',
          'src/eventBus.ts',
          'scripts/bin.ts',
          'src/seed.ts',
          'src/types/**/*.ts',
          'src/client/**/*.ts',
          'src/init.ts',
          'src/browser/**/*.ts',
          'src/node/**/*.ts',
          'src/shared/**/*.ts',
          'src/db/**/*.ts',
          'src/helpers/**/*.ts',
          'src/interfaces/**/*.ts',
          'src/Item/**/*.ts',
          'src/ItemProperty/**/*.ts',
          'src/schema/**/*.ts',
          'src/seedSchema/**/*.ts',
          'src/stores/**/*.ts',
          'src/services/**/*.ts',
          'src/events/**/*.ts',
          'src/graphql/**/*.ts',
        ],
        exclude: ['vite'],
        sourceMap: true,
      }),
      tsConfigPaths(),
      // dts(),
      commonjs({
        // transformMixedEsModules: true,
      }),
  
      // nodeResolver({
      //   browser: true,
      //   preferBuiltins: false,
      // }),
      copy({
        targets: [
          { src: 'src/**/*.ts', dest: 'dist/src' },
          { src: 'src/db/seedSchema', dest: 'dist/db' },
          { src: 'src/db/configs', dest: 'dist/db' },
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
      }),
      postProcess(),
    ],
  },
  // {
  //   input: 'src/workers/content-hash.ts',
  //   output: {
  //     dir: 'dist',
  //     format: 'esm',
  //     sourcemap: true,
  //     inlineDynamicImports: true,
  //   },
  //   plugins: [
  //     typescript({
  //       sourceMap: true,
  //     }),
  //     tsConfigPaths(),
  //     webWorkerLoader({
  //       preserveSource: false,
  //       preserveFileNames: false,
  //     }),
  //   ],
  // },
  // {
  //   input: 'src/workers/index.ts',
  //   output: {
  //     dir: 'dist',
  //     sourcemap: false,
  //     format: 'iife',
  //     inlineDynamicImports: true,
  //   },
  //   plugins: [
  //     // nodeResolve({
  //     //   browser: true,
  //     //   preferBuiltins: false,
  //     // }),
  //     commonjs(),
  //     // polyfillNode(),
  //     typescript(),
  //     webWorkerLoader({
  //       preserveSource: false,
  //       preserveFileNames: false,
  //     }),
  //   ],
  // }
]

export default config
