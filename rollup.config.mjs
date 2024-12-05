import typescript from '@rollup/plugin-typescript'
import { execSync } from 'node:child_process'
import copy from 'rollup-plugin-copy'
import tsConfigPaths from 'rollup-plugin-tsconfig-paths'
import commonjs from '@rollup/plugin-commonjs'

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
    ],
    plugins: [
      typescript({
        include: [
          'src/index.ts',
          'scripts/bin.ts',
          'src/seed.ts',
          'src/types/**/*.ts',
          'src/init.ts',
          'src/browser/**/*.ts',
          'src/node/**/*.ts',
          'src/shared/**/*.ts',
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
          { src: 'src/browser/db/seedSchema', dest: 'dist/browser/db' },
          { src: 'src/shared/configs', dest: 'dist/shared' },
          { src: 'src/shared/seedSchema', dest: 'dist/shared' },
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
]

export default config
