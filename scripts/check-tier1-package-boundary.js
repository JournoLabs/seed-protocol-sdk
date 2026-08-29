#!/usr/bin/env node
/**
 * Fail if lean Tier-1 packages declare heavy SDK/runtime deps.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const FORBIDDEN = [
  'drizzle-orm',
  'xstate',
  'better-sqlite3',
  'sqlocal',
  '@zenfs/core',
  '@zenfs/dom',
  '@sqlite.org/sqlite-wasm',
  '@tanstack/react-query',
]

const PACKAGES = ['eas', 'arweave', 'vite']

function checkPackage(shortName) {
  const pkgPath = join(rootDir, 'packages', shortName, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const fields = ['dependencies', 'optionalDependencies', 'peerDependencies']
  const violations = []
  for (const field of fields) {
    const block = pkg[field]
    if (!block) continue
    for (const dep of Object.keys(block)) {
      if (FORBIDDEN.some((f) => dep === f || dep.startsWith(`${f}/`))) {
        violations.push(`${shortName}: ${field}.${dep}`)
      }
    }
  }
  return violations
}

const all = PACKAGES.flatMap(checkPackage)
if (all.length > 0) {
  console.error('[tier1-boundary] Forbidden dependencies found:')
  for (const v of all) console.error(`  - ${v}`)
  process.exit(1)
}

console.log('[tier1-boundary] OK — eas, arweave, and vite stay lean')
