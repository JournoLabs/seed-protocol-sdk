import typescript from '@rollup/plugin-typescript'
import copy from 'rollup-plugin-copy'
import tsConfigPaths from 'rollup-plugin-tsconfig-paths'
import commonjs from '@rollup/plugin-commonjs'
import alias from '@rollup/plugin-alias'
import { fileURLToPath } from 'url'
import path from 'path'
import json from '@rollup/plugin-json'
import MagicString from 'magic-string'


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
 * Uses MagicString to preserve source maps when transforming.
 */
function twoStepDynamicImportPlugin() {
  // One full line: indent, LHS (destructure or id), path, then .then(...);
  // Export names may be minified (e.g. a, a$, a0) - use [\w$]+ to match
  const LINE_FUNC = /^(\s*)const\s+(\{[^}]+\}|\w+)\s*=\s*await\s+import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*function\s*\(\s*n\s*\)\s*\{\s*return\s+n\.([\w$]+)\s*;\s*\}\s*\)\s*;/gm
  const LINE_ARROW = /^(\s*)const\s+(\{[^}]+\}|\w+)\s*=\s*await\s+import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*n\s*=>\s*n\.([\w$]+)\s*\)\s*;/gm
  // Promise form (no await): const x = import('...').then(function (n) { return n.X; }) - rewrite to async IIFE
  const PROMISE_FUNC = /^(\s*)const\s+(\w+)\s*=\s*import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*function\s*\(\s*n\s*\)\s*\{\s*return\s+n\.([\w$]+)\s*;\s*\}\s*\)/gm
  const PROMISE_ARROW = /^(\s*)const\s+(\w+)\s*=\s*import\s*\(\s*('[^']+')\s*\)\s*\.then\s*\(\s*n\s*=>\s*n\.([\w$]+)\s*\)/gm

  return {
    name: 'two-step-dynamic-import',
    renderChunk(code, _chunk, options) {
      if (options.format !== 'es') return null

      const magicString = new MagicString(code)
      let chunkIndex = 0
      let changed = false

      magicString.replaceAll(LINE_FUNC, (_match, indent, lhs, importPath, exportName) => {
        changed = true
        const i = chunkIndex++
        return `${indent}const _mod_${i} = await import(${importPath});\n${indent}const _ns_${i} = _mod_${i}.${exportName};\n${indent}const ${lhs} = _ns_${i};`
      })
      magicString.replaceAll(LINE_ARROW, (_match, indent, lhs, importPath, exportName) => {
        changed = true
        const i = chunkIndex++
        return `${indent}const _mod_${i} = await import(${importPath});\n${indent}const _ns_${i} = _mod_${i}.${exportName};\n${indent}const ${lhs} = _ns_${i};`
      })
      magicString.replaceAll(PROMISE_FUNC, (_match, indent, lhs, importPath, exportName) => {
        changed = true
        const i = chunkIndex++
        return `${indent}const ${lhs} = (async () => { const _mod_${i} = await import(${importPath}); return _mod_${i}.${exportName}; })()`
      })
      magicString.replaceAll(PROMISE_ARROW, (_match, indent, lhs, importPath, exportName) => {
        changed = true
        const i = chunkIndex++
        return `${indent}const ${lhs} = (async () => { const _mod_${i} = await import(${importPath}); return _mod_${i}.${exportName}; })()`
      })

      if (!changed) return null

      return {
        code: magicString.toString(),
        map: magicString.generateMap({ hires: true }),
      }
    },
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
    external: ['@seedprotocol/feed'],
    plugins: [
      alias({
        entries: [
          { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') }
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
      if (id === '@seedprotocol/feed') return true
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
          { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') }
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
      postProcess(),
    ],
  },
]

export default config
