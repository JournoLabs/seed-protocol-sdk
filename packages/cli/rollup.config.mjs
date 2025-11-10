import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import copy from 'rollup-plugin-copy'
import preserveShebang from 'rollup-plugin-preserve-shebang'
import { execSync } from 'node:child_process'

const postProcess = () => {
  return {
    name: 'post-process',
    writeBundle() {
      const files = [
        'dist/bin.js',
        'dist/addModel.js'
      ]
      
      files.forEach(file => {
        try {
          execSync(`chmod +x ${file}`)
        } catch (error) {
          // File doesn't exist, skip
        }
      })
    },
  }
}

export default {
  input: {
    bin: 'src/bin.ts',
    addModel: 'src/addModel.ts',
  },
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true,
    entryFileNames: '[name].js',
    preserveModules: false,
  },
  external: [
    '@seedprotocol/sdk',
    'commander',
    'fs',
    'path',
    'child_process',
    'url',
    'node:process',
    'rimraf',
    'better-sqlite3',
    'drizzle-orm',
    'drizzle-kit',
    '@grpc/grpc-js',
    '@grpc/proto-loader'
  ],
  plugins: [
    preserveShebang(),
    typescript({
      tsconfig: './tsconfig.json',
    }),
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs({
      include: ['node_modules/**'],
    }),
    copy({
      targets: [
        {
          src: 'src/protos',
          dest: 'dist'
        },
        {
          src: 'src/seedData.json',
          dest: 'dist'
        }
      ],
    }),
    postProcess(),
  ],
}

