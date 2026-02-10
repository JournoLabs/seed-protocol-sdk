#!/usr/bin/env node
/**
 * Post-build safeguard: fail if any ESM dist file contains a runtime dynamic
 * import with a literal `@/` specifier (e.g. import('@/imports/json')).
 * Such strings break consumers that re-bundle the SDK (e.g. Vite) when their
 * resolve.alias for @/ points at the app, not the SDK.
 *
 * Scans all .js files under dist/ and excludes dist/cjs/ (CJS build is Node-only).
 * Exits 0 if no violations; exits 1 and prints file:line on violation.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'dist')

const BAD_PATTERNS = ["import('@/", 'import("@/']

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

let hadViolation = false
for (const filePath of walkJsFiles(distDir)) {
  const content = readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const codePart = line.split('//')[0]
    if (BAD_PATTERNS.some((p) => codePart.includes(p))) {
      const relPath = path.relative(rootDir, filePath)
      console.error(`[check-dist-no-alias] ${relPath}:${i + 1} contains @/ dynamic import`)
      console.error(line.trim())
      hadViolation = true
    }
  }
}

if (hadViolation) {
  process.exit(1)
}
process.exit(0)
