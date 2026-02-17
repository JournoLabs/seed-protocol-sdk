#!/usr/bin/env node
/**
 * Post-build check: list (or fail on) ESM dist lines that use the pattern
 * "dynamic import then property access on minified export", e.g.:
 *   const { BaseDb } = await import('./Chunk.js').then(function (n) { return n.aP; })
 * When a consumer re-bundles the SDK, those export names can change and
 * destructuring throws "Cannot destructure property 'X' of '(intermediate value)' as it is undefined".
 *
 * Scans all .js under dist/, excludes dist/cjs/.
 * Usage: node scripts/check-dist-fragile-dynamic-imports.js [--fail]
 *   --fail  Exit 1 if any match found; otherwise exit 0 and print matches.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'packages', 'sdk', 'dist')

const failMode = process.argv.includes('--fail')

// Match: .then(function (n) { return n.XXX or .then(n => n.XXX
const FRAGILE_REGEX = /\.then\s*\(\s*function\s*\(\s*n\s*\)\s*\{\s*return\s+n\.(\w+)/g
const FRAGILE_ARROW_REGEX = /\.then\s*\(\s*n\s*=>\s*n\.(\w+)/g

function* walkJsFiles(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const relFromDist = path.relative(distDir, full)
    if (entry.isDirectory()) {
      if (relFromDist === 'cjs' || relFromDist.startsWith('cjs' + path.sep)) continue
      yield* walkJsFiles(full)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      yield full
    }
  }
}

const matches = []
for (const filePath of walkJsFiles(distDir)) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const codePart = line.split('//')[0]
    if (!codePart.includes('import(')) continue
    if (!codePart.includes('.then')) continue
    const m1 = FRAGILE_REGEX.exec(codePart)
    const m2 = FRAGILE_ARROW_REGEX.exec(codePart)
    const m = m1 || m2
    if (m) {
      const relPath = path.relative(rootDir, filePath)
      matches.push({ file: relPath, line: i + 1, exportName: m[1] })
    }
  }
}

for (const { file, line, exportName } of matches) {
  console.log(`${file}:${line} (export n.${exportName})`)
}

if (failMode && matches.length > 0) {
  process.exit(1)
}
process.exit(0)
