#!/usr/bin/env node
/**
 * Post-build step: publish a package's ambient module declarations with its .d.ts.
 *
 * tsc doesn't emit hand-written .d.ts files such as `src/shims.d.ts` (typings for
 * dependencies that ship none), so a consumer compiling with `skipLibCheck: false` gets
 * TS7016 for every module they declare. This copies the file into dist and adds a
 * `/// <reference path>` to it from the entry declaration.
 *
 * Usage: node ../../scripts/ship-ambient-dts.js <src/file.d.ts> [dist/index.d.ts]
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [source, entry = 'dist/index.d.ts'] = process.argv.slice(2)
if (!source || !existsSync(source) || !existsSync(entry)) {
  console.error('[ship-ambient-dts] usage: ship-ambient-dts.js <src/file.d.ts> [dist/index.d.ts]')
  process.exit(1)
}

const target = path.join(path.dirname(entry), path.basename(source))
copyFileSync(source, target)
const reference = `/// <reference path="./${path.basename(source)}" />\n`
const content = readFileSync(entry, 'utf8')
if (!content.startsWith(reference)) writeFileSync(entry, reference + content)
console.log(`[ship-ambient-dts] ${target}, referenced from ${entry}`)
