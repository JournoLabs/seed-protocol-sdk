#!/usr/bin/env node
/**
 * Post-build check: fail if ESM dist contains import shapes that break Vite 8
 * renderer consumers (default import from CJS browser entries, path-browserify default).
 *
 * Usage: node scripts/check-dist-fragile-imports.js [--fail]
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'packages', 'sdk', 'dist')

const failMode = process.argv.includes('--fail')

/** Patterns that commonly cause "does not provide an export named 'default'" at runtime. */
const FRAGILE_PATTERNS = [
  {
    name: 'debug-browser-default-import',
    regex: /import\s+\w+\s+from\s+['"]debug\/src\/browser(?:\.js)?['"]/,
  },
  {
    name: 'path-browserify-default-import',
    regex: /import\s+path\s+from\s+['"]path-browserify['"]/,
  },
]

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
    for (const { name, regex } of FRAGILE_PATTERNS) {
      if (regex.test(codePart)) {
        matches.push({
          file: path.relative(rootDir, filePath),
          line: i + 1,
          pattern: name,
          text: line.trim(),
        })
      }
    }
  }
}

for (const m of matches) {
  console.log(`${m.file}:${m.line} [${m.pattern}] ${m.text}`)
}

if (failMode && matches.length > 0) {
  process.exit(1)
}
process.exit(0)
