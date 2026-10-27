#!/usr/bin/env node
/**
 * Post-build step: give every relative specifier in a package's emitted .d.ts files the
 * extension Node's resolver needs.
 *
 * tsc copies specifiers into declarations as written, and the packages' sources import
 * without extensions (`./client`, `./helpers` for a directory). Under
 * `moduleResolution: node16`/`nodenext` a consumer can't resolve those: names re-exported
 * with `export *` disappear (TS2305) and named re-exports become `any`. This rewrites
 * `./x` to `./x.js` when `x.d.ts` exists and to `./x/index.js` when `x/index.d.ts` does,
 * in `from '...'`, `import('...')` and `declare module '...'`.
 *
 * tsc also keeps `paths` aliases as written. `--alias ~/` treats specifiers starting with
 * `~/` as relative to the dist root (the package's `rootDir`) and rewrites them the same way.
 *
 * Usage: node ../../scripts/fix-dts-specifiers.js [distDir] [--alias <prefix>]
 * distDir defaults to ./dist. Exits 1 if a specifier resolves to no declaration file.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const aliasIndex = args.indexOf('--alias')
const alias = aliasIndex === -1 ? null : args.splice(aliasIndex, 2)[1]
const distDir = path.resolve(args[0] ?? 'dist')
if (!existsSync(distDir)) {
  console.error(`[fix-dts-specifiers] ${distDir} does not exist`)
  process.exit(1)
}

// `from 'x'`, `import('x')`, `declare module 'x'`, `import 'x'`; group 3 is the specifier.
const SPECIFIER_REGEX = /(\bfrom\s+|\bimport\s*\(\s*|\bdeclare\s+module\s+|^\s*import\s+)(['"])([^'"\n]+)\2/gm
const isRelative = (specifier) => /^\.{1,2}(\/|$)/.test(specifier)

/** `~/a/b` seen from dist/x/y.d.ts becomes `../a/b`. */
function unalias(fromFile, specifier) {
  let rel = path.relative(path.dirname(fromFile), path.join(distDir, specifier.slice(alias.length)))
  rel = rel.split(path.sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function* walkDtsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkDtsFiles(full)
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) yield full
  }
}

const isFile = (p) => existsSync(p) && statSync(p).isFile()

/** Returns the rewritten specifier, the unchanged one when it already resolves, or null. */
function resolveSpecifier(fromFile, specifier) {
  const target = path.resolve(path.dirname(fromFile), specifier)
  if (/\.(m|c)?js$/.test(specifier)) {
    return isFile(target.replace(/\.(m|c)?js$/, '.d.$1ts')) ? specifier : null
  }
  if (specifier.endsWith('.json')) return isFile(target) ? specifier : null
  const base = specifier.replace(/\/$/, '')
  if (isFile(`${target}.d.ts`)) return `${base}.js`
  if (isFile(path.join(target, 'index.d.ts'))) return `${base}/index.js`
  return null
}

const unresolved = []
let rewritten = 0
for (const file of walkDtsFiles(distDir)) {
  const content = readFileSync(file, 'utf8')
  const next = content.replace(SPECIFIER_REGEX, (match, prefix, quote, original) => {
    const specifier = alias && original.startsWith(alias) ? unalias(file, original) : original
    if (!isRelative(specifier)) return match
    const resolved = resolveSpecifier(file, specifier)
    if (resolved === null) {
      unresolved.push(`${path.relative(process.cwd(), file)}: '${original}'`)
      return match
    }
    return `${prefix}${quote}${resolved}${quote}`
  })
  if (next !== content) {
    writeFileSync(file, next)
    rewritten++
  }
}

if (unresolved.length > 0) {
  console.error(`[fix-dts-specifiers] ${unresolved.length} relative specifier(s) resolve to no declaration:`)
  for (const line of unresolved) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`[fix-dts-specifiers] ${path.relative(process.cwd(), distDir) || '.'}: ${rewritten} file(s) rewritten`)
