#!/usr/bin/env node
/**
 * Post-build step: rewrite @/ path aliases to relative paths in emitted .d.ts files.
 *
 * TypeScript preserves path aliases in declaration output. Consumers don't have
 * the SDK's @/ mapping, so they cannot resolve imports like `from '@/types/helpers'`.
 * This script rewrites those to relative paths (e.g. `from '../types/helpers'`)
 * so declarations resolve correctly for consumers.
 *
 * The @/ alias maps to src/* (per packages/sdk/tsconfig.json). In dist, the
 * structure mirrors src, so dist/src/ mirrors src/.
 *
 * Usage: node scripts/rewrite-dts-alias-to-relative.js
 * Run after tsc emits declarations (e.g. after "tsc -p packages/sdk/tsconfig.declarations.json").
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'packages', 'sdk', 'dist')
const distSrcDir = path.join(distDir, 'src')

// Match @/path in import specifiers: from '@/x', from "@/x", import('@/x'), import("@/x")
// Captures the path part (x) and the quote char for correct replacement
const ALIAS_REGEX = /@\/([a-zA-Z0-9_/.-]+)/g

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

/**
 * Compute relative path from a .d.ts file to the target of @/aliasPath.
 * @/ maps to src/*, so in dist it's dist/src/*.
 */
function getRelativePath(fromDtsPath, aliasPath) {
  const fromDir = path.dirname(fromDtsPath)
  const targetPath = path.join(distSrcDir, aliasPath)
  let rel = path.relative(fromDir, targetPath)
  // Use forward slashes for ES module imports (cross-platform)
  rel = rel.replace(/\\/g, '/')
  // Ensure path starts with . so it's resolved as relative, not a bare specifier
  if (!rel.startsWith('.')) {
    rel = './' + rel
  }
  return rel
}

function rewriteFile(filePath) {
  let content = readFileSync(filePath, 'utf8')
  const fromDir = path.dirname(filePath)

  const newContent = content.replace(ALIAS_REGEX, (match, aliasPath) => {
    const relativePath = getRelativePath(filePath, aliasPath)
    return relativePath
  })

  if (content !== newContent) {
    writeFileSync(filePath, newContent)
    return true
  }
  return false
}

let rewrittenCount = 0
for (const filePath of walkDtsFiles(path.join(distDir, 'src'))) {
  if (rewriteFile(filePath)) {
    rewrittenCount++
    const relPath = path.relative(rootDir, filePath)
    console.log(`[rewrite-dts-alias] ${relPath}`)
  }
}

if (rewrittenCount > 0) {
  console.log(`[rewrite-dts-alias] Rewrote @/ imports in ${rewrittenCount} file(s)`)
}
