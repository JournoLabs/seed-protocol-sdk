#!/usr/bin/env node
/**
 * Type-checks every package's published declarations the way an installed app sees them:
 * an app with node_modules/@seedprotocol/* linked to packages/*, importing each `exports`
 * entry, compiled with `skipLibCheck: false` under `moduleResolution: nodenext` and again
 * under `bundler`.
 *
 * Only errors in this repo's declarations (packages/<name>/dist) and in the app fail the
 * check. Some dependencies' own declarations don't compile without `skipLibCheck`
 * (drizzle-orm 0.44's mysql, singlestore and gel builders; thirdweb's type-utils); those are
 * counted and printed, not failed, so apps that import them still need `skipLibCheck`.
 *
 * Besides compiling, the app checks a few names that broke before: re-exports through
 * `export *` must exist and must not be `any` (under nodenext an extensionless specifier
 * in a .d.ts made them TS2305 or `any`).
 *
 * Needs built dists (SKIP_TESTS=1 node scripts/build-packages.js). Exits 1 and prints the
 * compiler output on any error.
 *
 * Usage: node scripts/check-dts-consumer.js [--keep]
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = path.join(root, 'packages')
const keep = process.argv.includes('--keep')

const packages = fs
  .readdirSync(packagesDir)
  .filter((dir) => fs.existsSync(path.join(packagesDir, dir, 'package.json')))
  .map((dir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf8'))
    return { dir, name: manifest.name, exports: manifest.exports ?? { '.': {} } }
  })
  .filter((p) => !JSON.parse(fs.readFileSync(path.join(packagesDir, p.dir, 'package.json'), 'utf8')).private)

const missing = packages.filter((p) => !fs.existsSync(path.join(packagesDir, p.dir, 'dist')))
if (missing.length > 0) {
  console.error(`[check-dts-consumer] no dist for ${missing.map((p) => p.name).join(', ')}; build first`)
  process.exit(1)
}

/** Entries whose declarations only make sense with a runtime hook or are not code. */
const SKIP_ENTRIES = new Set(['./package.json', './node-eas-lodash'])

const specifiers = packages.flatMap((p) =>
  Object.keys(p.exports)
    .filter((key) => !SKIP_ENTRIES.has(key))
    .map((key) => (key === '.' ? p.name : `${p.name}/${key.slice(2)}`)),
)

const importLines = specifiers.map((spec, i) => `import * as m${i} from '${spec}'`)
const useLines = specifiers.map((_, i) => `m${i}`)

// A value that is `any` accepts this assignment; a typed one doesn't.
const notAny = (expr) => `// @ts-expect-error ${expr} must not be any\nconst _${expr.replace(/\W/g, '_')}: { readonly __notAny: unique symbol } = ${expr}`

const checks = `
import { useItems, useItem, useItemProperty, useCreateItem } from '@seedprotocol/react'
import { client, Item } from '@seedprotocol/sdk'
import { importJsonSchema } from '@seedprotocol/sdk/node'

${notAny('useItems')}
${notAny('useItem')}
${notAny('useItemProperty')}
${notAny('useCreateItem')}
${notAny('client')}
${notAny('Item')}
${notAny('importJsonSchema')}
`

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dts-consumer-')))
const scopeDir = path.join(tmp, 'node_modules', '@seedprotocol')
fs.mkdirSync(scopeDir, { recursive: true })
for (const p of packages) {
  fs.symlinkSync(path.join(packagesDir, p.dir), path.join(scopeDir, p.name.split('/')[1]), 'dir')
}
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'dts-consumer', type: 'module' }))
fs.writeFileSync(
  path.join(tmp, 'index.ts'),
  `${importLines.join('\n')}\n\nexport const all = [${useLines.join(', ')}]\n${checks}`,
)

const modes = [
  { name: 'nodenext', module: 'nodenext', moduleResolution: 'nodenext' },
  { name: 'bundler', module: 'esnext', moduleResolution: 'bundler' },
]

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
// tsc prints each file relative to the app, through the realpath of the linked package.
const isOurs = (line) => {
  const file = path.resolve(tmp, line.slice(0, line.indexOf('(')))
  return file === path.join(tmp, 'index.ts') || (file.startsWith(packagesDir + path.sep) && file.includes(`${path.sep}dist${path.sep}`))
}
let failed = false
for (const mode of modes) {
  const tsconfig = {
    compilerOptions: {
      target: 'esnext',
      lib: ['esnext', 'dom', 'dom.iterable'],
      module: mode.module,
      moduleResolution: mode.moduleResolution,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      jsx: 'react-jsx',
      types: ['node'],
      typeRoots: [path.join(root, 'node_modules', '@types')],
    },
    files: ['index.ts'],
  }
  fs.writeFileSync(path.join(tmp, `tsconfig.${mode.name}.json`), JSON.stringify(tsconfig, null, 2))
  const result = spawnSync(process.execPath, [tsc, '-p', `tsconfig.${mode.name}.json`, '--pretty', 'false'], {
    cwd: tmp,
    encoding: 'utf8',
  })
  const output = `${result.stdout}${result.stderr}`.trim()
  const errors = output.split('\n').filter((line) => /error TS\d+/.test(line))
  const ours = errors.filter(isOurs)
  const theirs = errors.length - ours.length
  const note = theirs > 0 ? ` (${theirs} error(s) in dependencies' declarations, not counted)` : ''
  if (ours.length > 0 || (result.status !== 0 && errors.length === 0)) {
    failed = true
    console.error(`[check-dts-consumer] ${mode.name}: ${ours.length} error(s) in Seed declarations${note}`)
    console.error(ours.length > 0 ? ours.join('\n') : output)
  } else {
    console.log(`[check-dts-consumer] ${mode.name}: ${specifiers.length} entries type-check${note}`)
  }
}

if (keep) console.log(`[check-dts-consumer] kept ${tmp}`)
else fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
