import typescript from '@rollup/plugin-typescript'
import { execSync } from 'node:child_process'
import copy from 'rollup-plugin-copy'
import tsConfigPaths from 'rollup-plugin-tsconfig-paths'
import commonjs from '@rollup/plugin-commonjs'
import alias from '@rollup/plugin-alias'
import { fileURLToPath } from 'url'
import path from 'path'
import json from '@rollup/plugin-json'


const postProcess = () => {
  return {
    name: 'post-process',
    writeBundle() {
    },
  }
}

const config = [
  // ESM build
  {
    input: {
      main: 'src/index.ts',
      node: 'src/node/index.ts',
      vite: 'src/vite/index.ts', // Separate entry for vite plugin (Node.js only)
    },
    output: [
      {
        // ESM bundle used as the SDK's browser/renderer entry.
        // We deliberately do NOT use preserveModules here, so that Rollup
        // can emit a clean ESM graph without internal CommonJS helper chunks.
        dir: 'dist',
        format: 'esm',
        sourcemap: true,
        entryFileNames: '[name].js',
      },
    ],
    plugins: [
      json(),
      tsConfigPaths(),
      typescript({
        exclude: ['__tests__/**/*', 'scripts/**/*', '**/scripts/**/*'],
        jsx: 'react',
        tsconfig: './tsconfig.rollup.json',
        include: ['src/**/*'],
      }),
      copy({
        targets: [
          { src: 'src/db/seedSchema', dest: 'dist/db' },
          { src: 'src/seedSchema', dest: 'dist' },
          { src: 'src/db/drizzle', dest: 'dist/db/drizzle' },
        ],
      }),
      postProcess(),
    ],
  },
  // CommonJS build - Node.js only
  {
    input: {
      'main.cjs': 'src/node/index.ts', // We'll create this
      'vite.cjs': 'src/vite/index.ts', // Vite plugin CommonJS build
    },
    output: [
      {
        dir: 'dist',
        format: 'cjs',
        sourcemap: true,
        preserveModules: false,
        entryFileNames: '[name]',
        // CJS chunks go under dist/cjs/ so they do not overwrite ESM chunks in dist/
        chunkFileNames: 'cjs/[name]-[hash].js',
      },
    ],
    external: (id) => {
      // Mark browser imports as external for Node.js build
      if (id.includes('/browser/') || id.includes('\\browser\\')) {
        return true
      }
      // Standard externals
      return [
        'drizzle-orm',
        'path-browserify',
        '@zenfs/core',
        '@zenfs/dom',
        'arweave',
        'tslib',
        'better-sqlite3',
        'react',
        'react-dom',
        'typia',
        'fsevents',
        'hardhat',
        'mocha',
      ].includes(id) || id.startsWith('drizzle-orm/') || id.startsWith('@zenfs/')
    },
    plugins: [
      json(),
      alias({
        entries: [
          { find: /^@\/(.*)$/, replacement: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src/$1') }
        ]
      }),
      tsConfigPaths({
        tsConfigPath: './tsconfig.cjs.json',
      }),
      typescript({
        exclude: ['__tests__/**/*', 'src/browser/**/*', 'scripts/**/*', '**/scripts/**/*'],
        jsx: 'react',
        tsconfig: './tsconfig.cjs.json',
        include: ['src/**/*'],
      }),
      commonjs({
        include: ['node_modules/**'],
      }),
      copy({
        targets: [
          { src: 'src/db/seedSchema', dest: 'dist/db' },
          { src: 'src/seedSchema', dest: 'dist' },
        ],
      }),
      postProcess(),
    ],
  },
]

export default config
