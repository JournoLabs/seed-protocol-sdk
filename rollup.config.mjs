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

/**
 * Rewrites fragile dynamic-import pattern to two-step form so consumer re-bundles
 * (e.g. Electron) don't break: replace
 *   const { x } = await import('./chunk.js').then(n => n.aR);
 * with
 *   const _mod_0 = await import('./chunk.js');
 *   const _ns_0 = _mod_0.aR;
 *   const { x } = _ns_0;
 * Uses a per-chunk counter (_mod_0, _ns_0, _mod_1, _ns_1, ...) so multiple
 * replacements in one chunk do not produce duplicate declarations.
 * ESM build only (renderChunk receives format from output options).
 */
function twoStepDynamicImportPlugin() {
  // One full line: indent, LHS (destructure or id), path, then .then(...);
  const LINE_FUNC = /^(\s*)const\s+(\{[^}]+\}|\w+)\s*=\s*await\s+import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*function\s*\(\s*n\s*\)\s*\{\s*return\s+n\.(\w+)\s*;\s*\}\s*\)\s*;/gm
  const LINE_ARROW = /^(\s*)const\s+(\{[^}]+\}|\w+)\s*=\s*await\s+import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*n\s*=>\s*n\.(\w+)\s*\)\s*;/gm
  // Promise form (no await): const x = import('...').then(function (n) { return n.X; }) - rewrite to async IIFE
  const PROMISE_FUNC = /^(\s*)const\s+(\w+)\s*=\s*import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*function\s*\(\s*n\s*\)\s*\{\s*return\s+n\.(\w+)\s*;\s*\}\s*\)/gm
  const PROMISE_ARROW = /^(\s*)const\s+(\w+)\s*=\s*import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*n\s*=>\s*n\.(\w+)\s*\)/gm

  return {
    name: 'two-step-dynamic-import',
    renderChunk(code, _chunk, options) {
      if (options.format !== 'es') return null
      let out = code
      let chunkIndex = 0
      let changed = true
      while (changed) {
        changed = false
        out = out.replace(LINE_FUNC, (_, indent, lhs, path, exportName) => {
          changed = true
          const i = chunkIndex++
          return `${indent}const _mod_${i} = await import(${path});\n${indent}const _ns_${i} = _mod_${i}.${exportName};\n${indent}const ${lhs} = _ns_${i};`
        })
        if (!changed) {
          out = out.replace(LINE_ARROW, (_, indent, lhs, path, exportName) => {
            changed = true
            const i = chunkIndex++
            return `${indent}const _mod_${i} = await import(${path});\n${indent}const _ns_${i} = _mod_${i}.${exportName};\n${indent}const ${lhs} = _ns_${i};`
          })
        }
        if (!changed) {
          out = out.replace(PROMISE_FUNC, (_, indent, lhs, path, exportName) => {
            changed = true
            const i = chunkIndex++
            return `${indent}const ${lhs} = (async () => { const _mod_${i} = await import(${path}); return _mod_${i}.${exportName}; })()`
          })
        }
        if (!changed) {
          out = out.replace(PROMISE_ARROW, (_, indent, lhs, path, exportName) => {
            changed = true
            const i = chunkIndex++
            return `${indent}const ${lhs} = (async () => { const _mod_${i} = await import(${path}); return _mod_${i}.${exportName}; })()`
          })
        }
      }
      return out
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
      alias({
        entries: [
          { find: /^@\/(.*)$/, replacement: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src/$1') }
        ]
      }),
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
      twoStepDynamicImportPlugin(),
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
      // copy({
      //   targets: [
      //     { src: 'src/db/seedSchema', dest: 'dist/db' },
      //     { src: 'src/seedSchema', dest: 'dist' },
      //   ],
      // }),
      postProcess(),
    ],
  },
]

export default config
