#!/usr/bin/env node
/**
 * Fail if browser-reachable Seed entries statically import Node builtins,
 * drizzle-orm/migrator, or js-sha3.
 *
 * Walks source entries (and published dist when present).
 * Usage: node scripts/check-browser-entry-graph.js [--fail]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const failMode = process.argv.includes('--fail')

const FORBIDDEN = [
  { name: 'fs', re: /(?:from|import)\s+['"]fs(?:\/promises)?['"]/ },
  { name: 'path', re: /(?:from|import)\s+['"]path['"]/ },
  { name: 'crypto', re: /(?:from|import)\s+['"]crypto['"]/ },
  { name: 'node:fs', re: /(?:from|import)\s+['"]node:fs(?:\/promises)?['"]/ },
  { name: 'node:path', re: /(?:from|import)\s+['"]node:path['"]/ },
  { name: 'node:crypto', re: /(?:from|import)\s+['"]node:crypto['"]/ },
  { name: 'drizzle-orm/migrator', re: /(?:from|import)\s+['"]drizzle-orm\/migrator['"]/ },
  { name: 'js-sha3', re: /(?:from|import)\s+['"]js-sha3['"]/ },
]

const ENTRIES = [
  'packages/query/src/index.ts',
  'packages/eas/src/index.ts',
  'packages/sdk/src/browser/db/Db.ts',
  'packages/sdk/src/platform/index.browser.ts',
  'packages/react/src/index.ts',
]

const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g

const matches = []
const visited = new Set()

function resolveImport(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]
  return candidates.find((c) => existsSync(c) && !c.endsWith(path.sep))
}

function walk(file) {
  const abs = path.resolve(rootDir, file)
  if (visited.has(abs) || !existsSync(abs)) return
  visited.add(abs)
  const content = readFileSync(abs, 'utf8')
  const rel = path.relative(rootDir, abs)
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const codePart = lines[i].split('//')[0]
    for (const { name, re } of FORBIDDEN) {
      if (re.test(codePart)) {
        matches.push({ file: rel, line: i + 1, pattern: name, text: lines[i].trim() })
      }
    }
  }
  RELATIVE_IMPORT.lastIndex = 0
  let m
  const src = content.replace(/\/\*[\s\S]*?\*\//g, '')
  while ((m = RELATIVE_IMPORT.exec(src)) !== null) {
    const next = resolveImport(abs, m[1])
    if (next) walk(path.relative(rootDir, next))
  }
}

function walkDir(dir, skip = []) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(rootDir, full)
    if (skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`) || rel.startsWith(`${prefix}${path.sep}`))) {
      continue
    }
    if (entry.isDirectory()) walkDir(full, skip)
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) walk(rel)
  }
}

for (const entry of ENTRIES) {
  walk(entry)
}

walkDir(path.join(rootDir, 'packages/sdk/src/browser'))
walkDir(path.join(rootDir, 'packages/query/src'), [
  'packages/query/src/cache/FileCache.ts',
  'packages/query/src/index.node.ts',
  'packages/query/src/node',
])

const distEntries = [
  'packages/query/dist/index.js',
  'packages/eas/dist/index.js',
  'packages/sdk/dist/main.js',
  'packages/react/dist/index.js',
]
if (process.argv.includes('--dist')) {
  for (const entry of distEntries) {
    if (existsSync(path.join(rootDir, entry))) walk(entry)
  }
}

let pluralizeInGraph = false
for (const file of visited) {
  const content = readFileSync(file, 'utf8')
  if (/(?:from|import)\s+['"]pluralize['"]/.test(content)) {
    pluralizeInGraph = true
    break
  }
}

if (pluralizeInGraph) {
  try {
    const require = createRequire(import.meta.url)
    const viteSrc = path.join(rootDir, 'packages/vite/src/index.ts')
    const viteDist = path.join(rootDir, 'packages/vite/dist/index.js')
    const pluginPath = existsSync(viteDist) ? viteDist : viteSrc
    if (existsSync(path.join(rootDir, 'packages/vite/src/index.ts'))) {
      const src = readFileSync(path.join(rootDir, 'packages/vite/src/index.ts'), 'utf8')
      if (!src.includes("'pluralize'") && !src.includes('"pluralize"')) {
        matches.push({
          file: 'packages/vite/src/index.ts',
          line: 0,
          pattern: 'pluralize-optimizeDeps',
          text: 'browser graph imports pluralize but seedVitePlugin does not list it in optimizeDeps',
        })
      }
    }
    void require
    void pluginPath
  } catch {
    // plugin source check above is sufficient
  }
}

for (const m of matches) {
  console.log(`${m.file}:${m.line} [${m.pattern}] ${m.text}`)
}

if (matches.length === 0) {
  console.log(`[browser-entry-graph] OK — scanned ${visited.size} files`)
}

if (failMode && matches.length > 0) {
  process.exit(1)
}
process.exit(0)
