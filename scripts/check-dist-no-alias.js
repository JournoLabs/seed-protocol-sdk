#!/usr/bin/env node
/**
 * Post-build safeguard: fail if any ESM dist file contains a runtime dynamic
 * import with a literal `@/` specifier (e.g. import('@/imports/json')).
 * Such strings break consumers that re-bundle the SDK (e.g. Vite) when their
 * resolve.alias for @/ points at the app, not the SDK.
 *
 * Also fails if any .d.ts file under dist/src/ contains @/ imports. Those
 * break consumers' TypeScript resolution since they don't have the SDK's @/
 * path mapping. (The rewrite-dts-alias-to-relative.js script must run after
 * tsc to fix this.)
 *
 * Scans all .js files under dist/ (excludes dist/cjs/) and all .d.ts under dist/src/.
 * Exits 0 if no violations; exits 1 and prints file:line on violation.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'packages', 'sdk', 'dist')
const distSrcDir = path.join(distDir, 'src')

const BAD_JS_PATTERNS = ["import('@/", 'import("@/']

// Any @/ in .d.ts is bad (should have been rewritten to relative by rewrite-dts-alias-to-relative.js)
const BAD_DTS_PATTERN = /@\//

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

function* walkDtsFiles(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkDtsFiles(full)
    } else if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      yield full
    }
  }
}

let hadViolation = false

for (const filePath of walkJsFiles(distDir)) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const codePart = line.split('//')[0]
    if (BAD_JS_PATTERNS.some((p) => codePart.includes(p))) {
      const relPath = path.relative(rootDir, filePath)
      console.error(`[check-dist-no-alias] ${relPath}:${i + 1} contains @/ dynamic import`)
      console.error(line.trim())
      hadViolation = true
    }
  }
}

for (const filePath of walkDtsFiles(distSrcDir)) {
  const content = readFileSync(filePath, 'utf8')
  if (BAD_DTS_PATTERN.test(content)) {
    const relPath = path.relative(rootDir, filePath)
    console.error(`[check-dist-no-alias] ${relPath} contains @/ import (run rewrite-dts-alias-to-relative.js after tsc)`)
    hadViolation = true
  }
}

if (hadViolation) {
  process.exit(1)
}
process.exit(0)
